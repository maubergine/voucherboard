package com.mariusrubin.voucherboard.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max

/**
 * The board, as BoardScreen.swift: vehicles down the side and days across, for a week, four weeks or one day. A phone
 * turned sideways shows it full screen (`standalone`); otherwise Calendar pushes it. Select mode picks several blocks
 * to cancel or remove together.
 */
@Composable
fun BoardScreen(model: AppModel, standalone: Boolean, onBack: (() -> Unit)? = null) {
    var zoom by remember { mutableStateOf("week") }
    var cursor by remember { mutableStateOf<String?>(null) }
    var board by remember { mutableStateOf<Board?>(null) }
    var selecting by remember { mutableStateOf(false) }
    LaunchedEffect(model.version, zoom, cursor) {
        board = model.view<Board>("board", cursor?.let { args("zoom" to zoom, "dk" to it) } ?: args("zoom" to zoom))
    }

    fun tap(b: Block) {
        if (!selecting) return model.open(b)
        // Only planned items and upcoming bookings can be managed together, as on the web UI.
        if (b.status != "plan" && b.status != "up") return
        model.boardSelection = if (b.sel in model.boardSelection) model.boardSelection - b.sel else model.boardSelection + b.sel
    }

    val actions: @Composable RowScope.() -> Unit = {
        if (zoom != "cal") {
            IconButton({ cursor = board?.prev }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Earlier") }
            IconButton({ cursor = board?.next }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Later") }
        }
        if (selecting) {
            BarButton("Manage ${model.boardSelection.size}", enabled = model.boardSelection.isNotEmpty()) { model.sheet = Sheet.Bulk(model.boardSelection.sorted()) }
            BarButton("Done") { selecting = false; model.boardSelection = emptySet() }
        } else {
            BarButton("Select") { selecting = true }
        }
    }
    val picker: @Composable () -> Unit = {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((id, label) in listOf("cal" to "4 weeks", "week" to "Week", "day" to "Day")) {
                ChoiceChip(label, zoom == id) { if (zoom != id) { zoom = id; cursor = null } }
            }
        }
    }
    val grid: @Composable () -> Unit = {
        board?.let { BoardGrid(it, if (selecting) model.boardSelection else emptySet(), selecting = selecting, tap = ::tap) } ?: Spacer(Modifier.fillMaxSize())
    }

    if (standalone || onBack == null) {
        Column(Modifier.fillMaxSize().background(vb.card).windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout))) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                picker()
                Text(board?.label ?: "Board", style = Type.headline, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                actions()
            }
            grid()
        }
    } else {
        Pushed(board?.label ?: "Board", onBack, actions = actions) { pad ->
            Column(Modifier.fillMaxSize().padding(pad).background(vb.card)) {
                picker()
                grid()
            }
        }
    }
}

/** The lane label's width and the row height grow with the font size, up to a limit. */
@Composable private fun labelWidth() = minOf(92.dp * LocalDensity.current.fontScale, 150.dp)
@Composable private fun rowHeight() = minOf(46.dp * LocalDensity.current.fontScale, 80.dp)

@Composable
fun BoardGrid(
    board: Board,
    selection: Set<String>,
    selecting: Boolean = false,
    tap: (Block) -> Unit,
    /** A tap on an empty part of a lane: its vehicle, day and time (to the quarter hour). */
    tapEmpty: ((String, String, Int) -> Unit)? = null,
) {
    val labelW = labelWidth()
    val rowH = rowHeight()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val n = board.days.size
        val dayWidth: Dp = (maxWidth - labelW - 8.dp) / max(1, n)
        val span = max(1, board.to - board.from)
        val x = { m: Int -> dayWidth * ((m - board.from).toFloat() / span) }
        Column(Modifier.fillMaxSize()) {
            Header(board, dayWidth, labelW, x)
            HorizontalDivider(color = vb.separator)
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                if (board.lanes.isEmpty()) {
                    Text("Nothing booked or planned here.", style = Type.subheadline, color = vb.secondary, modifier = Modifier.padding(24.dp))
                }
                for (lane in board.lanes) {
                    Row {
                        Column(Modifier.padding(start = 8.dp).width(labelW).height(rowH), verticalArrangement = Arrangement.Center) {
                            PlateBadge(lane.plate, 11f, maxScale = 1.4f)
                            if (lane.name != lane.plate) Text(lane.name, style = Type.caption2, color = vb.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Box(Modifier.width(dayWidth * n).height(rowH).clipToBounds()) {
                            board.days.forEachIndexed { i, d ->
                                DayBackground(d, dayWidth, rowH, x, Modifier.offset(x = dayWidth * i).pointerInput(d.dk, lane.vrn, tapEmpty) {
                                    detectTapGestures { p ->
                                        val f = tapEmpty
                                        if (d.bookable && f != null) f(lane.vrn, d.dk, board.from + (p.x / size.width * span).toInt() / 15 * 15)
                                    }
                                })
                            }
                            for (b in lane.blocks) {
                                val w = maxOf(6.dp, x(b.t) - x(b.f))
                                BlockView(
                                    b, compact = board.zoom != "day" || w < 60.dp, selected = b.sel in selection, selecting = selecting,
                                    modifier = Modifier.offset(x = dayWidth * b.dayIndex + x(b.f), y = 7.dp).size(w, rowH - 14.dp).clickable { tap(b) },
                                )
                            }
                            board.now?.let { now ->
                                Box(Modifier.offset(x = dayWidth * now.dayIndex + x(now.min) - 1.dp).width(2.dp).height(rowH).background(vb.bad))
                            }
                        }
                    }
                    HorizontalDivider(color = vb.separator)
                }
            }
        }
    }
}

@Composable
private fun Header(board: Board, dayWidth: Dp, labelW: Dp, x: (Int) -> Dp) {
    Row(Modifier.padding(vertical = 4.dp)) {
        Spacer(Modifier.width(labelW + 8.dp).height(if (board.zoom == "day") 22.dp else 30.dp))
        if (board.zoom == "day") {
            Box(Modifier.width(dayWidth).height(22.dp)) {
                for (h in board.hours) {
                    Text(h.short, style = Type.caption2.merge(Mono), color = vb.secondary, maxLines = 1, softWrap = false, modifier = Modifier.offset(x = x(h.min) - 6.dp))
                }
            }
        } else {
            for (d in board.days) {
                Box(Modifier.width(dayWidth).height(30.dp), contentAlignment = Alignment.Center) {
                    Text(
                        if (dayWidth < 52.dp) d.short ?: d.label else d.label, style = Type.caption, fontWeight = if (d.today) FontWeight.Bold else FontWeight.Normal, maxLines = 1,
                        color = if (d.today) vb.accent else if (d.off) vb.secondary else vb.label, textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

@Composable
private fun DayBackground(d: Board.Day, width: Dp, rowH: Dp, x: (Int) -> Dp, modifier: Modifier) {
    Box(modifier.width(width).height(rowH).background(if (d.off) vb.fill else if (d.today) vb.accent.copy(alpha = 0.04f) else Color.Transparent)) {
        // Controlled hours: a faint fill, with solid lines where they start and end so they show without the tint.
        for (c in d.controls) {
            Box(Modifier.offset(x = x(c.f)).width(maxOf(0.dp, x(c.t) - x(c.f))).height(rowH).background(vb.accent.copy(alpha = 0.08f))) {
                Box(Modifier.align(Alignment.CenterStart).width(1.5.dp).fillMaxHeight().background(vb.accent))
                Box(Modifier.align(Alignment.CenterEnd).width(1.5.dp).fillMaxHeight().background(vb.accent))
            }
        }
        Box(Modifier.width(0.5.dp).height(rowH).background(vb.separator))
    }
}
