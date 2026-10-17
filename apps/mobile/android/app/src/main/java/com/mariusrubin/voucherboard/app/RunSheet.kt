package com.mariusrubin.voucherboard.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Review and run: what will be sent, then each step as it goes to the council site, then the result. As RunSheet.swift. */
@Composable
fun RunSheet(model: AppModel) {
    var run by remember { mutableStateOf<RunView?>(null) }
    LaunchedEffect(model.version) { run = model.view("run") }
    // Can't be closed by Back: the run ends with Back, Done or Later (iOS: interactiveDismissDisabled).
    BackHandler {}

    SheetScaffold(
        title = run?.title ?: "", onClose = null,
        actions = {
            run?.let { r ->
                val live = r.tag == "Live"
                Tag(r.tag.uppercase(), if (live) vb.accent else TestInk, if (live) vb.soft else TestYellow, r.tag)
                Spacer(Modifier.width(12.dp))
            }
        },
        bottomBar = { run?.let { r -> BottomActions { Footer(model, r) } } },
    ) { pad ->
        InsetList(Modifier.padding(pad)) {
            val r = run ?: return@InsetList
            if (r.phase == "running") {
                item {
                    Section {
                        Cell(first = true) {
                            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                LinearProgressIndicator({ r.progress / 100f }, Modifier.fillMaxWidth(), color = vb.accent, trackColor = vb.soft)
                                // Each step and the result are read out (live regions), since TalkBack can't see the bar move.
                                Text(r.label, style = Type.footnote.merge(Mono), color = vb.text2, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                            }
                        }
                    }
                }
            }
            if (r.phase == "done") {
                item {
                    Section {
                        Cell(first = true) {
                            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics(mergeDescendants = true) {}, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Icon(if (r.failed) Icons.Filled.Cancel else Icons.Filled.CheckCircle, null, Modifier.size(52.dp), tint = if (r.failed) vb.bad else vb.ok)
                                Text(r.note, textAlign = TextAlign.Center, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                            }
                        }
                        r.reminder?.let { rem ->
                            Cell {
                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(rem, style = Type.subheadline, fontWeight = FontWeight.SemiBold)
                                    Text("Change this in More.", style = Type.footnote, color = vb.secondary)
                                }
                            }
                        }
                    }
                }
            }
            if (r.phase == "review") item { Section { LabeledRow("Unused", r.balance, first = true) } }
            item {
                Section(headerContent = if (r.phase == "review") ({ Text(r.heading, style = Type.headline) }) else null) {
                    r.ops.forEachIndexed { i, op ->
                        Cell(first = i == 0) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                PillView(Pill(op.tag, if (op.kind == "cancel") "change" else "booked"))
                                PlateBadge(op.plate, 12f)
                                Text(op.text, style = Type.footnote.merge(Mono), color = vb.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Status(op)
                                    op.err?.let { e -> Text(e, style = Type.caption2, color = vb.bad, textAlign = TextAlign.End) }
                                }
                            }
                        }
                    }
                }
            }
            if (r.phase == "review") {
                item { Section(footer = r.modeNote) { Cell(first = true) { Text(r.info, style = Type.footnote) } } }
            }
        }
    }
}

@Composable
private fun Status(op: RunView.Op) {
    when (op.status) {
        "run" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = vb.accent)
            Text(op.statusText, style = Type.caption, fontWeight = FontWeight.SemiBold)
        }
        "done", "test" -> Text(op.statusText, style = Type.caption, fontWeight = FontWeight.SemiBold, color = vb.ok)
        "fail" -> Text(op.statusText, style = Type.caption, fontWeight = FontWeight.SemiBold, color = vb.bad)
        else -> Text(op.statusText, style = Type.caption, color = vb.secondary)
    }
}

@Composable
private fun Footer(model: AppModel, r: RunView) {
    val full = Modifier.fillMaxWidth()
    when (r.phase) {
        "review" -> {
            PrimaryButton(r.goLabel, full, large = true) { model.launchAct("runGo") }
            SecondaryButton("Back", full, large = true) { model.launchAct("closeRun") }
        }
        "running" -> SecondaryButton(if (r.stopping) "Stopping…" else "Stop after this step", full, enabled = !r.stopping, large = true) { model.launchAct("stopRun") }
        else -> {
            if (r.hasReport) SecondaryButton("Share error details", full, large = true) { model.launchAct("shareReport") }
            if (r.canResume) {
                PrimaryButton("Resume", full, large = true) { model.launchAct("review") }
                SecondaryButton("Later", full, large = true) { model.launchAct("closeRun") }
            } else {
                PrimaryButton("Done", full, large = true) { model.launchAct("closeRun") }
            }
        }
    }
}
