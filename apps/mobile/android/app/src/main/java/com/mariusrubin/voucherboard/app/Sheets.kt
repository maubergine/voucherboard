package com.mariusrubin.voucherboard.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Your plan: what will be booked or cancelled, buying advice, and Review. As PlanSheet in Sheets.swift. */
@Composable
fun PlanSheet(model: AppModel) {
    var plan by remember { mutableStateOf<PlanView?>(null) }
    var confirmClear by remember { mutableStateOf(false) }
    var buying by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(model.version) { plan = model.view("plan") }

    SheetScaffold(
        title = "Your plan", onClose = { model.sheet = null },
        bottomBar = {
            plan?.let { p ->
                BottomActions { PrimaryButton(p.reviewLabel, Modifier.fillMaxWidth(), enabled = p.ready, large = true) { model.launchAct("review") } }
            }
        },
    ) { pad ->
        InsetList(Modifier.padding(pad)) {
            val p = plan ?: return@InsetList
            item { Text(p.subtitle, style = Type.footnote, color = vb.secondary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) }
            item {
                Section {
                    if (p.empty) Cell(first = true) { Text("Your plan is empty.", color = vb.secondary) }
                    p.items.forEachIndexed { i, it ->
                        if (i > 0 || p.empty) androidx.compose.material3.HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp, color = vb.separator)
                        // Swipe to remove, as on iOS.
                        SwipeAction(if (it.change) "Drop" else "Remove") { model.launchAct("removeEntry", args("id" to it.id)) }.invoke {
                            Cell(onClick = { model.sheet = Sheet.Entry(it.id) }, first = true) {
                                Column(Modifier.padding(end = 12.dp).fillMaxWidth(0.16f), horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(it.day, style = Type.caption, fontWeight = FontWeight.Bold, color = vb.secondary, maxLines = 1)
                                    Text(it.date, style = Type.caption2, color = vb.secondary, maxLines = 1)
                                }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        PlateBadge(it.plate, 13f)
                                        if (it.smart == true) PillView(Pill("Smart replan", "plan")) else if (it.change) PillView(Pill("Change", "change"))
                                    }
                                    Text(listOf(it.time, it.need).filter { s -> s.isNotEmpty() }.joinToString(" · "), style = Type.subheadline.merge(Mono), color = vb.text2)
                                    it.bad?.let { b -> Text(b, style = Type.footnote, color = vb.bad) }
                                    ReplanCountdown(it.startsAt, it.countdownText)
                                }
                            }
                        }
                    }
                }
            }
            p.replans?.takeIf { it.isNotEmpty() }?.let { rs ->
                item {
                    Section {
                        p.replanBar?.let { ReplanBarView(model, it) }
                        rs.forEachIndexed { i, r -> ReplanCard(model, r, pickable = p.replanBar != null, first = p.replanBar == null && i == 0) }
                    }
                }
            }
            p.advice?.let { a ->
                item {
                    Section(background = if (a.tone == "warn") vb.warnSoft else vb.soft) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(a.title, style = Type.subheadline, fontWeight = FontWeight.SemiBold)
                            Text(a.text, style = Type.footnote, color = vb.secondary)
                            for (b in a.buys) {
                                PrimaryButton(if (buying == b.kind) "Checking…" else b.label, enabled = buying == null, small = true) {
                                    buying = b.kind
                                    scope.launch {
                                        val r = model.act("buy", args("kind" to b.kind, "n" to b.n))
                                        buying = null
                                        if (r.err == null) model.sheet = null
                                    }
                                }
                            }
                            a.payHelp?.let { help -> PayHelp(model, help) }
                        }
                    }
                }
            }
            p.cost?.let { c -> item { Section { Cell(first = true) { Text(c, style = Type.subheadline, fontWeight = FontWeight.SemiBold) } } } }
            if (!p.empty) item { Section { CellButton("Clear plan", first = true, destructive = true) { confirmClear = true } } }
        }
    }
    if (confirmClear) {
        ConfirmDialog("Clear the whole plan?", confirm = "Clear plan", dismiss = "Cancel", onDismiss = { confirmClear = false }) {
            model.sheet = null
            model.launchAct("clearPlan")
        }
    }
}

/** Folded under the buy buttons: what to do if paying in the app fails, with a button to buy in the browser. */
@Composable
private fun PayHelp(model: AppModel, help: PlanView.Advice.PayHelp) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.Filled.Warning, null, Modifier.size(16.dp), tint = vb.text2)
            Text(help.title, style = Type.footnote, fontWeight = FontWeight.SemiBold, color = vb.text2, modifier = Modifier.weight(1f))
            Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = vb.accent)
        }
        if (open) {
            Text(help.text, style = Type.footnote, color = vb.secondary)
            TextButton({ model.launchAct("buyInBrowser") }, contentPadding = PaddingValues(0.dp)) {
                Text(help.button, style = Type.footnote, fontWeight = FontWeight.SemiBold, color = vb.accent)
            }
        }
    }
}

/** A planned booking or change: its time, what it uses, and Remove. */
@Composable
fun EntrySheet(model: AppModel, id: Int) {
    var e by remember { mutableStateOf<EntryView?>(null) }
    var gone by remember { mutableStateOf(false) }
    var from by remember { mutableIntStateOf(0) }
    var to by remember { mutableIntStateOf(0) }
    var kind by remember { mutableStateOf("") }
    var fromDk by remember { mutableStateOf("") }
    var toDk by remember { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(model.version) {
        val fresh = model.view<EntryView>("entry", args("id" to id))
        if (e == null && fresh != null) {
            from = fresh.from; to = fresh.to; kind = fresh.kinds?.firstOrNull { it.on }?.id ?: ""
            fromDk = fresh.stay?.dk ?: ""; toDk = fresh.stay?.toDk ?: ""
        }
        e = fresh
        gone = fresh == null
    }

    SheetScaffold(
        title = e?.title ?: "Planned booking", onClose = { model.sheet = null },
        actions = {
            val cur = e
            val same = cur != null && from == cur.from && to == cur.to && kind == (cur.kinds?.firstOrNull { it.on }?.id ?: "") &&
                fromDk == (cur.stay?.dk ?: "") && toDk == (cur.stay?.toDk ?: "")
            BarButton("Save time", enabled = cur != null && cur.smart != true && !same) {
                scope.launch {
                    val a = mutableListOf<Pair<String, Any?>>("id" to id, "from" to from, "to" to to)
                    if (cur?.kinds != null) a += "kind" to kind
                    if (cur?.stay != null) { a += "dk" to fromDk; a += "toDk" to toDk }
                    val r = model.act("setEntryTime", args(*a.toTypedArray()))
                    val x = r.err
                    if (x != null) err = x else model.sheet = null
                }
            }
        },
    ) { pad ->
        InsetList(Modifier.padding(pad)) {
            val v = e
            if (v == null) {
                if (gone) item { Section { Cell(first = true) { Text("This is no longer in your plan.", color = vb.secondary) } } }
                return@InsetList
            }
            item {
                Section(footer = "Nothing is sent until you review your plan.") {
                    Cell(first = true) { PlateAndName(v.plate, v.name) }
                }
            }
            item {
                if (v.smart == true) {
                    Section(footer = "Part of a smart replan of this vehicle's bookings.") { LabeledRow(v.dayText, v.ctl, first = true) }
                } else {
                    Section {
                        LabeledRow(v.dayText, v.ctl, first = true)
                        val st = v.stay
                        if (st != null) {
                            // Start to end: a day and a time for each end.
                            Cell { DayTimePicker("Starts", fromDk, from, st.days, pickDay = { fromDk = it; if (toDk < it) toDk = it }, pickTime = { from = it }) }
                            Cell { DayTimePicker("Ends", toDk, to, st.days.filter { it.dk >= fromDk }, pickDay = { toDk = it }, pickTime = { to = it }) }
                        } else {
                            val (rf, ru) = timeRanges(v.limits)
                            Cell {
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    TimePicker("From", from, rf, modifier = Modifier.weight(1f)) { from = it; if (to <= it) to = minOf(it + 60, ru.last) }
                                    TimePicker("Until", to, ru, modifier = Modifier.weight(1f)) { to = it }
                                }
                            }
                        }
                        v.kinds?.let { ks -> PickerCell("Vouchers", ks.firstOrNull { it.id == kind }?.text ?: "", ks.map { it.id to it.text }) { kind = it } }
                        err?.let { x -> Cell { Text(x, style = Type.footnote, color = vb.bad, modifier = Modifier.announce()) } }
                    }
                }
            }
            v.cost?.let { cost ->
                item {
                    Section {
                        Cell(first = true) { Text(cost, style = Type.subheadline, fontWeight = FontWeight.SemiBold) }
                        for (n in v.notes) Cell { Text(n.text, style = Type.footnote, color = if (n.tone == "bad") vb.bad else vb.secondary) }
                    }
                }
            }
            item {
                Section {
                    CellButton(v.removeLabel, first = true, destructive = true) {
                        model.sheet = null
                        model.launchAct("removeEntry", args("id" to id))
                    }
                }
            }
        }
    }
}

/** A booking: its vouchers, and Change time, Cancel, End early or Book again. */
@Composable
fun VisitSheet(model: AppModel, key: String) {
    var v by remember { mutableStateOf<VisitView?>(null) }
    var gone by remember { mutableStateOf(false) }
    var mode by remember { mutableStateOf("") }
    var from by remember { mutableIntStateOf(0) }
    var to by remember { mutableIntStateOf(0) }
    var option by remember { mutableIntStateOf(0) }
    var changeKind by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // Not closed by Back while a cancel is going (iOS: interactiveDismissDisabled).
    BackHandler(enabled = busy) {}
    LaunchedEffect(model.version) {
        val fresh = model.view<VisitView>("visit", args("key" to key))
        if (v == null && fresh != null) { from = fresh.start; to = fresh.end }
        v = fresh
        gone = fresh == null
    }

    SheetScaffold(title = "Booking", onClose = { model.sheet = null }) { pad ->
        InsetList(Modifier.padding(pad)) {
            val b = v
            if (b == null) {
                if (gone) item { Section { Cell(first = true) { Text("This booking is no longer on the council site.", color = vb.secondary) } } }
                return@InsetList
            }
            item {
                Section {
                    Cell(first = true) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                            Column(Modifier.weight(1f)) { PlateAndName(b.plate, b.name) }
                            PillView(Pill(b.statusText, if (b.status == "live") "live" else if (b.status == "past") "past" else "booked"))
                        }
                    }
                }
            }
            item {
                Section {
                    if (b.starts != null && b.ends != null) {
                        LabeledRow("Starts", b.starts, first = true, mono = true)
                        LabeledRow("Ends", b.ends, mono = true)
                    } else {
                        LabeledRow("Day", b.dayText, first = true)
                        LabeledRow("Time", b.time, mono = true)
                    }
                    Cell {
                        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row {
                                Text("Vouchers", style = Type.body, modifier = Modifier.weight(1f))
                                Text(b.vouchersText, style = Type.body, color = vb.secondary)
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                                for (x in b.vouchers) {
                                    // The running voucher: full accent, a green ring and a clock, so it stands out without colour.
                                    val bg = if (x.running) vb.accent else if (x.past) vb.past else vb.upcoming
                                    val fg = if (x.running) vb.onAccent else Color.White
                                    Row(
                                        Modifier.weight(1f).padding(horizontal = if (x.running) 3.dp else 0.dp)
                                            .then(if (x.running) Modifier.border(2.5.dp, vb.ok, RoundedCornerShape(7.dp)).padding(3.dp) else Modifier)
                                            .heightIn(min = 26.dp).clip(RoundedCornerShape(5.dp)).background(bg).padding(vertical = 6.dp)
                                            .clearAndSetSemantics { contentDescription = if (x.running) "${x.label}, running now" else x.label },
                                        horizontalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        if (x.running) Icon(Icons.Filled.Schedule, null, Modifier.size(12.dp), tint = fg)
                                        Text(x.label, style = Type.caption2.merge(Mono), fontWeight = FontWeight.ExtraBold, color = fg, textAlign = TextAlign.Center)
                                    }
                                }
                            }
                            SelectionContainer { Text(b.refs, style = Type.caption, color = vb.text2) }
                            b.permits?.let { Text(it, style = Type.caption, color = vb.text2) }
                        }
                    }
                }
            }
            item {
                when (mode) {
                    "change" -> Section(headerContent = { AnnouncedHeader("Change time") }, footer = "The booking is cancelled and rebooked at the new time when you review your plan.") {
                        val (rf, ru) = timeRanges(b.limits)
                        Cell(first = true) {
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                TimePicker("From", from, rf, modifier = Modifier.weight(1f)) { from = it; if (to <= it) to = minOf(it + 60, ru.last) }
                                TimePicker("Until", to, ru, modifier = Modifier.weight(1f)) { to = it }
                            }
                        }
                        b.kinds?.let { ks -> PickerCell("Vouchers", ks.firstOrNull { it.id == changeKind }?.text ?: "", ks.map { it.id to it.text }) { changeKind = it } }
                        err?.let { x -> Cell { Text(x, style = Type.footnote, color = vb.bad, modifier = Modifier.announce()) } }
                        Cell {
                            PrimaryButton("Add change to plan") {
                                scope.launch {
                                    val r = model.act("planChange", if (b.kinds != null) args("key" to key, "from" to from, "to" to to, "kind" to changeKind) else args("key" to key, "from" to from, "to" to to))
                                    val x = r.err
                                    if (x != null) err = x else model.sheet = null
                                }
                            }
                        }
                        CellButton("Back") { mode = ""; err = null }
                    }
                    "cancel" -> Section(footer = "This goes to the council site straight away. It isn't added to your plan.") {
                        Cell(first = true) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("Cancel this booking?", style = Type.headline, modifier = Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite })
                                Text("${b.dayText}, ${b.time}", style = Type.subheadline)
                                Text(b.cancelText, style = Type.subheadline, fontWeight = FontWeight.SemiBold, color = vb.bad)
                            }
                        }
                        CellButton(if (busy) "Cancelling…" else "Cancel booking", destructive = true, enabled = !busy) {
                            busy = true
                            scope.launch { model.act("cancelVisit", args("key" to key)); model.sheet = null }
                        }
                        CellButton("Keep it", enabled = !busy) { mode = "" }
                    }
                    "end" -> Section(headerContent = { AnnouncedHeader("End early") }, footer = "The voucher running now can't be cancelled, so a booking can only end when a voucher ends.") {
                        b.shrink.forEachIndexed { i, o ->
                            Cell(onClick = { option = o.index }, first = i == 0) {
                                RadioButton(option == o.index, { option = o.index }, colors = RadioButtonDefaults.colors(selectedColor = vb.accent))
                                Column(Modifier.weight(1f)) {
                                    Text("End at ${o.end}", style = Type.body.merge(Mono))
                                    Text(o.returns, style = Type.footnote, color = vb.secondary)
                                }
                            }
                        }
                        CellButton(if (busy) "Cancelling…" else "End at ${b.shrink.firstOrNull { it.index == option }?.end ?: ""}", first = b.shrink.isEmpty(), destructive = true, enabled = !busy && b.shrink.isNotEmpty()) {
                            busy = true
                            scope.launch { model.act("endEarly", args("key" to key, "index" to option)); model.sheet = null }
                        }
                        CellButton(b.keepLabel, enabled = !busy) { mode = "" }
                    }
                    else -> Section(footer = b.note.takeIf { it.isNotEmpty() }) {
                        var n = 0
                        if (b.canChange) CellButton("Change time", first = n++ == 0) { mode = "change" }
                        CellButton("Book again", first = n++ == 0) { model.book(Seed(vrns = listOf(b.vrn), days = emptyList(), from = b.start, to = b.end)) }
                        if (b.canEndEarly) CellButton("End early", first = n++ == 0, destructive = true) { mode = "end" }
                        if (b.canCancel) CellButton("Cancel booking", first = n++ == 0, destructive = true) { mode = "cancel" }
                    }
                }
            }
        }
    }
}

/** Several board items at once: cancel the bookings and remove the planned ones. */
@Composable
fun BulkSheet(model: AppModel, keys: List<String>) {
    var b by remember { mutableStateOf<BulkView?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(model.version) { b = model.view("bulk", args("keys" to keys)) }

    SheetScaffold(title = b?.title ?: "", onClose = { model.sheet = null }) { pad ->
        InsetList(Modifier.padding(pad)) {
            val v = b ?: return@InsetList
            item {
                Section(footer = v.note.takeIf { it.isNotEmpty() }) {
                    v.items.forEachIndexed { i, it ->
                        Cell(first = i == 0) {
                            PlateBadge(it.plate, 13f)
                            Spacer(Modifier.padding(start = 8.dp))
                            Text(it.text, style = Type.subheadline, color = vb.secondary, modifier = Modifier.weight(1f))
                            PillView(Pill(it.pill, if (it.pill == "Planned") "plan" else "booked"))
                        }
                    }
                }
            }
            v.single?.let { one ->
                item {
                    Section {
                        CellButton("Change time", first = true) {
                            model.boardSelection = emptySet()
                            val id = if (one.startsWith("e:")) one.drop(2).toIntOrNull() else null
                            model.sheet = if (id != null) Sheet.Entry(id) else Sheet.Visit(one.drop(2))
                        }
                    }
                }
            }
            if (v.action.isNotEmpty()) {
                item {
                    Section(footer = if (v.cancels) "Cancelling goes to the council site straight away." else null) {
                        CellButton(if (busy) "Working…" else v.action, first = true, destructive = true, enabled = !busy) { confirm = true }
                    }
                }
            }
        }
    }
    if (confirm) {
        ConfirmDialog("${b?.action ?: ""}?", confirm = "Yes", dismiss = "Keep", onDismiss = { confirm = false }) {
            busy = true
            scope.launch {
                model.act("bulkApply", args("keys" to keys))
                model.boardSelection = emptySet()
                model.sheet = null
            }
        }
    }
}

/** Save a new favourite: plate (typed or scanned) and nickname. */
@Composable
fun NewFavouriteSheet(model: AppModel) {
    var plate by remember { mutableStateOf("") }
    var nick by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var cands by remember { mutableStateOf(listOf<ActionResult.Candidate>()) }
    val scope = rememberCoroutineScope()

    fun scan(source: String) {
        scope.launch {
            val r = model.callScan(source)
            if (r.cancelled == true) return@launch
            err = r.err
            cands = r.cands ?: emptyList()
            if (cands.size == 1) { plate = cands[0].plate; cands = emptyList() }
        }
    }

    SheetScaffold(
        title = "Save a new favourite", onClose = { model.sheet = null },
        actions = {
            BarButton(if (busy) "Saving…" else "Save", enabled = !busy && plate.isNotEmpty() && nick.isNotEmpty()) {
                busy = true
                err = null
                scope.launch {
                    val r = model.act("saveFavourite", args("vrn" to plate, "nick" to nick, "isNew" to true))
                    busy = false
                    val x = r.err
                    if (x != null) err = x else model.sheet = null
                }
            }
        },
    ) { pad ->
        InsetList(Modifier.padding(pad)) {
            item {
                Section(footer = "Saved to your council account") {
                    Cell(first = true, padding = PaddingValues(start = 4.dp, end = 4.dp)) {
                        FieldText(plate, { plate = it }, "Number plate", KeyboardCapitalization.Characters, Modifier.weight(1f))
                        ScanButton("Scan a number plate") { scan(it) }
                    }
                    if (cands.isNotEmpty()) {
                        Cell {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                for (c in cands) TextButton({ plate = c.plate; cands = emptyList() }) { PlateBadge(c.plate, 13f) }
                            }
                        }
                    }
                    Cell(padding = PaddingValues(start = 4.dp, end = 4.dp)) {
                        FieldText(nick, { nick = it }, "Nickname", KeyboardCapitalization.Words, Modifier.weight(1f))
                    }
                    err?.let { x -> Cell { Text(x, style = Type.footnote, color = vb.bad, modifier = Modifier.announce()) } }
                }
            }
        }
    }
}

/** The plate large, with the name under it when it differs. */
@Composable
private fun PlateAndName(plate: String, name: String) {
    Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PlateBadge(plate, 24f)
        if (name != plate) Text(name, style = Type.headline)
    }
}
