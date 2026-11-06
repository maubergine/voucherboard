package com.mariusrubin.voucherboard.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarViewDay
import androidx.compose.material.icons.filled.ViewWeek
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

private data class DayDest(val dk: String)
private object BoardDest

/** Calendar, as CalendarScreen.swift: the booking window as weeks, the chosen day's agenda, Day timeline and Board. */
@Composable
fun CalendarScreen(model: AppModel, nav: Nav) {
    when (val top = nav.top) {
        is DayDest -> return DayScreen(model, top.dk, onBack = { nav.pop() })
        BoardDest -> return BoardScreen(model, standalone = false, onBack = { nav.pop() })
    }
    var cal by remember { mutableStateOf<CalendarView?>(null) }
    var selected by remember { mutableStateOf<String?>(null) }
    var cancelling by remember { mutableStateOf<Row?>(null) }
    LaunchedEffect(model.version, selected) {
        cal = model.view<CalendarView>("calendar", selected?.let { args("dk" to it) } ?: args())
    }

    InsetList(contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 96.dp)) {
        item {
            LargeTitle("Calendar") {
                IconButton({ nav.push(BoardDest) }) { Icon(Icons.Filled.ViewWeek, "Board", tint = vb.accent) }
            }
        }
        item { SignedOutBanner(model) }
        cal?.let { c ->
            item { Section { Cell(first = true) { MonthGrid(c) { selected = it } } } }
            val a = c.selected
            item {
                Section(headerContent = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(a.title, style = Type.headline)
                        Text(a.ctl, style = Type.footnote, color = vb.secondary)
                    }
                }) {
                    if (a.items.isEmpty()) Cell(first = true) { Text("Nothing booked or planned.", color = vb.secondary) }
                    a.items.forEachIndexed { i, row ->
                        RowSwipe(model, row, onCancel = { cancelling = it }) {
                            Cell(onClick = { model.open(row) }, first = i == 0) { RowView(row, showDay = false) }
                        }
                    }
                    CellButton("Day timeline", icon = Icons.Filled.CalendarViewDay) { nav.push(DayDest(a.dk)) }
                    if (a.bookable) CellButton("Book on this day", icon = Icons.Filled.Add) { model.book(Seed(days = listOf(a.dk))) }
                }
            }
        }
    }
    CancelAlert(model, cancelling) { cancelling = null }
}

/** The booking window as weeks, with dots for booked and planned days. */
@Composable
private fun MonthGrid(cal: CalendarView, pick: (String) -> Unit) {
    if (largeText()) MonthList(cal, pick) else Grid(cal, pick)
}

/** At the largest text sizes the weeks don't fit, so the days are a list. */
@Composable
private fun MonthList(cal: CalendarView, pick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (d in cal.days.filter { it.enabled }) {
            val label = listOfNotNull(d.label, "booked".takeIf { d.booked }, "planned".takeIf { d.planned }, "no controls".takeIf { d.off }).joinToString(", ")
            Row(
                Modifier.fillMaxWidth().clickable { pick(d.dk) }.semantics(mergeDescendants = true) { contentDescription = label; selected = d.selected },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(d.label, fontWeight = if (d.selected) FontWeight.Bold else FontWeight.Normal, color = if (d.today) vb.accent else vb.label, modifier = Modifier.weight(1f))
                if (d.booked) Dot(vb.accent, 10.dp)
                if (d.planned) Dot(vb.accent, 10.dp, outline = true)
            }
        }
    }
}

@Composable
private fun Grid(cal: CalendarView, pick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            for (w in cal.weekdays) Text(w, style = Type.caption, fontWeight = FontWeight.SemiBold, color = vb.secondary, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        for (week in cal.days.chunked(7)) {
            Row(Modifier.fillMaxWidth()) {
                for (d in week) {
                    val label = listOfNotNull(d.label, "booked".takeIf { d.booked }, "planned".takeIf { d.planned }, "no controls".takeIf { d.off }).joinToString(", ")
                    Column(
                        Modifier.weight(1f).clickable(enabled = d.enabled) { pick(d.dk) }
                            .semantics(mergeDescendants = true) { contentDescription = label; selected = d.selected },
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        val fg = when {
                            d.selected -> Color.White
                            d.off || !d.enabled -> vb.secondary
                            d.today -> vb.accent
                            else -> vb.label
                        }
                        Box(Modifier.size(34.dp).clip(CircleShape).background(if (d.selected) vb.accent else Color.Transparent), contentAlignment = Alignment.Center) {
                            Text("${d.date}", style = Type.body.merge(Mono), fontWeight = if (d.today) FontWeight.Bold else FontWeight.Normal, color = fg)
                        }
                        Row(Modifier.height(5.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            if (d.booked) Dot(vb.accent, 5.dp)
                            if (d.planned) Dot(vb.accent, 5.dp, outline = true)
                        }
                    }
                }
                repeat(7 - week.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}

/** One day: vehicles down the side, time across, as on the board. Tap a block to open it, or an empty slot to book. */
@Composable
fun DayScreen(model: AppModel, start: String, onBack: () -> Unit) {
    var dk by remember { mutableStateOf(start) }
    var day by remember { mutableStateOf<DayTimeline?>(null) }
    var board by remember { mutableStateOf<Board?>(null) }
    LaunchedEffect(model.version, dk) {
        day = model.view<DayTimeline>("day", args("dk" to dk))
        board = model.view<Board>("board", args("zoom" to "day", "dk" to dk))
    }
    Pushed(day?.title ?: "", onBack, actions = {
        IconButton({ day?.prev?.let { dk = it } }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Previous day") }
        IconButton({ day?.next?.let { dk = it } }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Next day") }
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).background(vb.card).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            day?.let { d ->
                Text(d.ctl, style = Type.footnote, color = vb.secondary, modifier = Modifier.padding(horizontal = 16.dp))
                if (d.lanes.isEmpty()) {
                    Text(if (d.bookable) "Nothing booked. Book a visitor to add one." else "Nothing booked.", style = Type.subheadline, color = vb.secondary, modifier = Modifier.padding(horizontal = 16.dp))
                }
            }
            board?.let { b ->
                BoardGrid(b, emptySet(), tap = { model.open(it) }, tapEmpty = { vrn, d, m ->
                    model.book(Seed(vrns = listOf(vrn), days = listOf(d), from = m, to = m + 60))
                })
            }
        }
    }
}

/** A booking or a planned entry on a timeline. Selected blocks get an outline in the text colour and a tick. */
@Composable
fun BlockView(
    block: Block, compact: Boolean, selected: Boolean = false, modifier: Modifier = Modifier,
    /** In select mode, blocks that can't be selected say why. */
    selecting: Boolean = false,
) {
    val plan = block.status == "plan"
    val fill = when {
        plan -> vb.accent.copy(alpha = 0.08f)
        block.status == "past" -> vb.past
        else -> vb.accent
    }
    val r = if (compact) 4.dp else 6.dp
    val shape = RoundedCornerShape(r)
    val state = when {
        plan -> "planned"
        block.status == "live" -> "on now"
        block.status == "past" -> "finished"
        else -> "booked"
    }
    val gap = vb.card
    val ok = vb.ok
    val line = vb.label
    Box(
        modifier.alpha(if (block.changing) 0.45f else 1f)
            // Drawn outside the block: a green ring set off by a gap in the background colour, so it shows against the
            // accent; and the selection outline.
            .drawBehind {
                fun ring(out: Dp, w: Dp, c: Color) {
                    val o = out.toPx(); val sw = w.toPx(); val rr = (r + out).toPx() - sw / 2
                    drawRoundRect(c, Offset(-o + sw / 2, -o + sw / 2), Size(size.width + 2 * o - sw, size.height + 2 * o - sw), CornerRadius(rr, rr), style = Stroke(sw))
                }
                if (block.status == "live") { ring(2.dp, 2.dp, gap); ring(5.dp, 3.dp, ok) }
            }
            .drawWithContent {
                drawContent()
                if (selected) {
                    val o = 3.dp.toPx(); val sw = 3.dp.toPx(); val rr = (r + 3.dp).toPx() - sw / 2
                    drawRoundRect(line, Offset(-o + sw / 2, -o + sw / 2), Size(size.width + 2 * o - sw, size.height + 2 * o - sw), CornerRadius(rr, rr), style = Stroke(sw))
                }
            }
            .semantics {
                contentDescription = block.say ?: "${block.label}, $state"
                this.selected = selected
                if (selecting && !(plan || block.status == "up")) stateDescription = "Can't be selected: it has started or finished."
            },
    ) {
        Box(Modifier.matchParentSize().clip(shape).background(fill).then(if (plan) Modifier.dashedCapsule(vb.accent, radius = r) else Modifier))
        if (!compact) {
            Text(
                block.label, style = Type.caption2.merge(Mono), fontWeight = FontWeight.Bold,
                color = if (plan) vb.accent else if (block.status == "past") Color.White else vb.onAccent,
                maxLines = 1, overflow = TextOverflow.Clip, modifier = Modifier.padding(4.dp),
            )
        }
        if (selected) {
            Box(Modifier.align(Alignment.TopCenter).offset(y = (-9).dp).size(15.dp).clip(CircleShape).background(vb.card), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.CheckCircle, null, tint = vb.label, modifier = Modifier.size(15.dp))
            }
        }
    }
}
