package com.mariusrubin.voucherboard.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Book a visitor: vehicle (typed, picked or scanned), when, how long. Add to plan, or Book now after a check step.
 * The form (`q`) lives in the engine's shape; every change goes through the engine, which returns the new view.
 * As QuickBookSheet.swift.
 */
@Composable
fun QuickBookSheet(model: AppModel, start: QuickStart) {
    var view by remember { mutableStateOf<QuickView?>(null) }
    var typed by remember { mutableStateOf("") }
    var sugg by remember { mutableStateOf<Suggestions?>(null) }
    var scan by remember { mutableStateOf(ScanState()) }
    var newVehicle by remember { mutableStateOf<NewVehicle?>(null) }
    var confirming by remember { mutableStateOf(false) }
    var focus by remember { mutableStateOf<String?>(null) }
    val focusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()

    fun update(name: String, vararg extra: Pair<String, Any?>) {
        val q = view?.q ?: return
        scope.launch { model.view<QuickView>(name, args(*extra, "q" to q))?.let { view = it } }
    }

    fun setVehicles(vrns: List<String>) {
        val q = view?.q ?: return
        scope.launch { model.view<QuickView>("quickView", args("q" to q.copy(vrns = vrns)))?.let { view = it } }
    }

    fun add(vrn: String) {
        val v = view ?: return
        if (vrn !in v.q.vrns) setVehicles(v.q.vrns + vrn)
        typed = ""
        newVehicle = null
        focusManager.clearFocus()
    }

    fun runScan(source: String) {
        scope.launch {
            scan = ScanState(busy = true)
            val r = model.callScan(source)
            scan = scan.copy(busy = false)
            if (r.cancelled == true) return@launch
            scan = scan.copy(cands = r.cands ?: emptyList(), err = r.err)
        }
    }

    LaunchedEffect(Unit) {
        if (view != null) return@LaunchedEffect
        val s = start.view
        val form = s.form
        val x = s.extend
        view = when {
            form != null -> model.view("quickView", args("q" to form))
            x != null -> model.view("quickExtend", args("vrn" to x.vrn, "dk" to x.dk, "end" to x.end))
            else -> {
                val opts = mutableMapOf<String, Any?>("vrns" to s.vrns)
                s.days?.let { opts["days"] = it }
                s.from?.let { opts["from"] = it }
                s.to?.let { opts["to"] = it }
                model.view<QuickView>("quickInit", args("opts" to opts)).also {
                    if (s.days != null && s.days.isEmpty()) model.show(Toast("Pick the days, then add them to your plan."))
                }
            }
        }
        scan = scan.copy(cands = start.cands, err = start.err)
        start.scan?.let { runScan(it) }
    }
    LaunchedEffect(typed) {
        sugg = model.view("suggest", args("text" to typed, "exclude" to (view?.q?.vrns ?: emptyList<String>())))
    }

    val v0 = view
    if (confirming && v0 != null) {
        ConfirmStep(model, v0.q) { confirming = false }
        return
    }

    SheetScaffold(
        title = "Book a visitor",
        onClose = { model.sheet = null },
        bottomBar = {
            val v = view
            if (v != null && focus == null) {
                // Side by side, or stacked at the largest text sizes.
                Equal(Modifier.fillMaxWidth().background(vb.grouped).padding(horizontal = 20.dp, vertical = 10.dp), 12.dp, {
                    SecondaryButton("Add to plan", it, enabled = v.preview.canAdd, large = true) {
                        scope.launch {
                            val r = model.act("addToPlan", args("q" to v.q))
                            if (r.err == null) model.sheet = null
                        }
                    }
                }, { PrimaryButton("Book now", it, enabled = v.preview.canBook, large = true) { confirming = true } })
            }
        },
    ) { pad ->
        InsetList(Modifier.padding(pad)) {
            val v = view
            if (v == null) {
                item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = vb.accent) } }
                return@InsetList
            }
            // Vehicle
            item {
                Section(header = "Vehicle") {
                    var n = 0
                    if (v.vehicles.isNotEmpty()) {
                        Cell(first = n++ == 0) {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                for (veh in v.vehicles) {
                                    Row(
                                        Modifier.clip(CircleShape).background(vb.soft).clickable { setVehicles(v.q.vrns.filter { it != veh.vrn }) }
                                            .padding(horizontal = 12.dp, vertical = 7.dp)
                                            .semantics(mergeDescendants = true) { contentDescription = "Remove ${veh.name}" },
                                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    ) {
                                        Text(veh.name, style = Type.subheadline, fontWeight = FontWeight.SemiBold)
                                        ChipClose()
                                    }
                                }
                            }
                        }
                    }
                    Cell(first = n++ == 0, padding = PaddingValues(start = 4.dp, end = 4.dp)) {
                        FieldText(
                            typed, { typed = it }, if (v.q.vrns.isEmpty()) "Name or plate, or a new plate" else "Add another vehicle",
                            KeyboardCapitalization.Characters, Modifier.weight(1f), onFocus = { f -> focus = if (f) "search" else if (focus == "search") null else focus },
                        )
                        ScanButton("Scan a number plate") { runScan(it) }
                    }
                    if (scan.busy || scan.err != null || scan.cands.isNotEmpty()) {
                        Cell(first = n++ == 0) {
                            ScanResults(scan) { c ->
                                scan = ScanState()
                                if (c.name != null) add(c.vrn) else newVehicle = NewVehicle(plate = c.plate, scanned = true)
                            }
                        }
                    }
                    val s = sugg
                    if (s != null) {
                        if (typed.isBlank()) {
                            if (v.q.vrns.isEmpty() && s.matches.isNotEmpty()) {
                                Cell(first = n++ == 0) {
                                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        for (m in s.matches) SecondaryButton(m.nick, small = true) { add(m.vrn) }
                                    }
                                }
                            }
                        } else {
                            for (m in s.matches) {
                                Cell(onClick = { add(m.vrn) }, first = n++ == 0) {
                                    if (m.name != m.plate) Text(m.name, style = Type.body)
                                    Spacer(Modifier.weight(1f))
                                    PlateBadge(m.plate, 12f)
                                }
                            }
                            val nv = s.newVrn
                            val np = s.newPlate
                            if (nv != null && np != null) {
                                Cell(onClick = { newVehicle = NewVehicle(plate = np); typed = ""; focusManager.clearFocus() }, first = n++ == 0) {
                                    Row(Modifier.weight(1f).semantics(mergeDescendants = true) { contentDescription = "New vehicle $nv" }, verticalAlignment = Alignment.CenterVertically) {
                                        Text("New vehicle", style = Type.body, fontWeight = FontWeight.SemiBold)
                                        Spacer(Modifier.weight(1f))
                                        PlateBadge(np, 12f)
                                    }
                                }
                            }
                            if (s.matches.isEmpty() && s.newVrn == null) Cell(first = n++ == 0) { Text("No vehicle matches.", color = vb.secondary) }
                        }
                    }
                }
            }
            newVehicle?.let { nv ->
                item {
                    NewVehicleSection(nv, { newVehicle = it }, onFocus = { f, name -> focus = if (f) name else if (focus == name) null else focus }, onCancel = { newVehicle = null }) {
                        focusManager.clearFocus()
                        newVehicle = nv.copy(checking = true, error = null)
                        scope.launch {
                            val r = model.act("addVehicle", args("vrn" to nv.plate, "save" to nv.save, "nick" to nv.nick))
                            newVehicle = newVehicle?.copy(checking = false)
                            val err = r.err
                            val vrn = r.vrn
                            if (err != null) newVehicle = newVehicle?.copy(error = err) else if (vrn != null) add(vrn)
                        }
                    }
                }
            }
            // When
            item {
                Section(header = "When") {
                    Cell(first = true) { WhenPicker(v.`when`) { update("quickWhen", "when" to it) } }
                    v.days?.let { d ->
                        Cell {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                for (c in d.choices) SecondaryButton(c.label, small = true) { update("quickPickDays", "id" to c.id) }
                            }
                        }
                        Cell { DayPicker(d.days) { update("quickToggleDay", "dk" to it) } }
                        Cell {
                            Text(
                                if (d.count > 0) (if (d.count == 1) "1 day chosen" else "${d.count} days chosen") else "No days chosen",
                                style = Type.footnote, color = vb.secondary,
                            )
                        }
                    }
                }
            }
            // How long
            item {
                Section(header = "How long") {
                    Cell(first = true) {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (p in v.presets) ChoiceChip(p.label, p.on) { update("quickPreset", "preset" to p.id) }
                        }
                    }
                    val (rf, ru) = timeRanges(v.limits, earliest = if (v.fromEditable) 0 else v.from)
                    Cell {
                        Equal(Modifier, 12.dp,
                            { TimeMenu("From", v.from, rf, enabled = v.fromEditable, modifier = it) { m -> update("quickTime", "which" to "from", "min" to m) } },
                            { TimeMenu("Until", v.to, ru, modifier = it) { m -> update("quickTime", "which" to "to", "min" to m) } },
                        )
                    }
                    Cell { Text(v.note, style = Type.footnote, color = vb.secondary) }
                }
            }
            // Preview
            item {
                Section {
                    Cell(first = true) {
                        Text(v.preview.text, style = Type.subheadline, fontWeight = FontWeight.SemiBold, color = if (v.preview.bad) vb.bad else vb.label)
                    }
                    for (note in v.preview.notes) Cell { Text(note, style = Type.footnote, color = vb.secondary) }
                }
            }
        }
    }
}

private data class ScanState(val busy: Boolean = false, val cands: List<ActionResult.Candidate> = emptyList(), val err: String? = null)

private data class NewVehicle(
    val plate: String, val save: Boolean = false, val nick: String = "", val scanned: Boolean = false,
    val error: String? = null, val checking: Boolean = false,
)

@Composable
private fun ScanResults(scan: ScanState, pick: (ActionResult.Candidate) -> Unit) {
    when {
        scan.busy -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = vb.accent)
            Text("Reading the number plate…", color = vb.secondary)
        }
        scan.err != null -> Text(scan.err, style = Type.footnote, color = vb.bad, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        scan.cands.isNotEmpty() -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (scan.cands.size > 1) "Plates found. Tap the right one" else "Plate found. Tap to use it", style = Type.footnote, fontWeight = FontWeight.SemiBold)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (c in scan.cands) {
                    Row(Modifier.clickable { pick(c) }.padding(2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        PlateBadge(c.plate, 13f)
                        c.name?.let { Text(it, style = Type.subheadline) }
                    }
                }
            }
            Text("Check it matches the car before you book.", style = Type.footnote, color = vb.secondary)
        }
    }
}

@Composable
private fun NewVehicleSection(nv: NewVehicle, set: (NewVehicle) -> Unit, onFocus: (Boolean, String) -> Unit, onCancel: () -> Unit, addVehicle: () -> Unit) {
    Section(header = if (nv.scanned) "New vehicle (check it matches the car)" else "New vehicle") {
        Cell(first = true, padding = PaddingValues(start = 4.dp, end = 4.dp)) {
            FieldText(
                nv.plate, { set(nv.copy(plate = it)) }, "Number plate", KeyboardCapitalization.Characters, Modifier.weight(1f),
                style = Type.title3.copy(fontWeight = FontWeight.Bold), onFocus = { onFocus(it, "plate") },
            )
        }
        Cell(onClick = { set(nv.copy(save = !nv.save)) }) {
            Column(Modifier.weight(1f)) {
                Text("Save as favourite", style = Type.body)
                Text("Saved to your council account with the first booking", style = Type.footnote, color = vb.secondary)
            }
            Switch(nv.save, { set(nv.copy(save = it)) })
        }
        if (nv.save) {
            Cell(padding = PaddingValues(start = 4.dp, end = 4.dp)) {
                FieldText(nv.nick, { set(nv.copy(nick = it)) }, "Nickname", KeyboardCapitalization.Words, Modifier.weight(1f), onFocus = { onFocus(it, "nick") })
            }
        }
        nv.error?.let { e -> Cell { Text(e, style = Type.footnote, color = vb.bad, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) } }
        Cell {
            PrimaryButton(if (nv.checking) "Checking…" else "Add vehicle", enabled = !nv.checking, onClick = addVehicle)
            Spacer(Modifier.weight(1f))
            TextButton(onCancel) { Text("Cancel", color = vb.accent) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WhenPicker(value: String, pick: (String) -> Unit) {
    val opts = listOf("now" to "Now", "today" to "Today", "days" to "Pick days")
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        opts.forEachIndexed { i, (id, label) ->
            SegmentedButton(
                selected = value == id, onClick = { if (value != id) pick(id) },
                shape = SegmentedButtonDefaults.itemShape(i, opts.size),
                colors = SegmentedButtonDefaults.colors(activeContainerColor = vb.soft, activeContentColor = vb.accent),
            ) { Text(label, maxLines = 1) }
        }
    }
}

/** The days a booking can be made, as weeks. */
@Composable
fun DayPicker(days: List<QuickView.Days.Day>, toggle: (String) -> Unit) {
    val heads = listOf("M", "T", "W", "T", "F", "S", "S")
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (h in heads) Text(h, style = Type.caption, fontWeight = FontWeight.SemiBold, color = vb.secondary, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        for (week in days.chunked(7)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (d in week) {
                    val bg = when { d.on -> vb.accent; d.off -> vb.fill; else -> Color.Transparent }
                    val fg = when { d.on -> Color.White; !d.enabled || d.off -> vb.secondary; else -> vb.label }
                    Box(
                        Modifier.weight(1f).heightIn(min = 36.dp).clip(RoundedCornerShape(8.dp)).background(bg)
                            .clickable(enabled = d.enabled) { toggle(d.dk) }
                            .semantics { contentDescription = d.label; selected = d.on },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("${d.date}", style = Type.subheadline.merge(Mono), fontWeight = if (d.today) FontWeight.Bold else FontWeight.Normal, color = fg)
                    }
                }
                repeat(7 - week.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** Check and book: what's about to be booked, the email switch, and the button. */
@Composable
fun ConfirmStep(model: AppModel, q: QuickForm, onBack: () -> Unit) {
    var view by remember { mutableStateOf<ConfirmView?>(null) }
    var email by remember { mutableStateOf(false) }
    var started by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onBack)
    LaunchedEffect(Unit) {
        if (view != null) return@LaunchedEffect
        val more = model.view<MoreView>("more")
        email = more?.settings?.emailAll ?: false
        view = model.view("confirm", args("q" to q, "email" to email))
    }
    SheetScaffold(
        title = "Check and book", onClose = onBack, back = true,
        bottomBar = {
            view?.let { c ->
                BottomActions {
                    PrimaryButton(c.goLabel, Modifier.fillMaxWidth(), enabled = !started, large = true) {
                        started = true
                        scope.launch {
                            val r = model.act("bookNow", args("q" to q, "email" to email))
                            if (r.err != null) started = false
                        }
                    }
                }
            }
        },
    ) { pad ->
        InsetList(Modifier.padding(pad)) {
            val c = view ?: return@InsetList
            item {
                Section {
                    Cell(first = true) {
                        val plate = c.plate
                        if (plate != null) {
                            Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                PlateBadge(plate, 24f)
                                c.name?.takeIf { it != plate }?.let { Text(it, style = Type.headline) }
                            }
                        } else {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                for (p in c.plates) PlateBadge(p, 15f)
                            }
                        }
                    }
                }
            }
            item {
                Section(footer = c.note) {
                    LabeledRow(c.dayLabel, c.dayText, first = true)
                    LabeledRow("Time", c.timeText, mono = true)
                    LabeledRow("Vouchers", c.vouchersText)
                    Cell(onClick = { email = !email }) {
                        Text("Send me a confirmation", style = Type.body, modifier = Modifier.weight(1f))
                        Switch(email, { email = it })
                    }
                }
            }
        }
    }
}

/** Scan with the camera or from a photo: a Scan button with a menu, as iOS's Scan menu. */
@Composable
fun ScanButton(description: String, scan: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton({ open = true }, Modifier.semantics { contentDescription = description }) {
            Icon(Icons.Filled.DocumentScanner, null, tint = vb.accent, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Scan", color = vb.accent)
        }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text("Use camera") }, leadingIcon = { Icon(Icons.Filled.PhotoCamera, null) }, onClick = { open = false; scan("camera") })
            DropdownMenuItem(text = { Text("Choose a photo") }, leadingIcon = { Icon(Icons.Filled.Photo, null) }, onClick = { open = false; scan("photos") })
        }
    }
}

/** A borderless one-line text field for a list row. */
@Composable
fun FieldText(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    caps: KeyboardCapitalization,
    modifier: Modifier = Modifier,
    style: TextStyle = Type.body,
    onFocus: (Boolean) -> Unit = {},
) {
    TextField(
        value, onChange, modifier.onFocusChanged { onFocus(it.isFocused) },
        placeholder = { Text(placeholder, style = style, color = vb.secondary) },
        textStyle = style, singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = caps, autoCorrectEnabled = caps != KeyboardCapitalization.Characters),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, disabledContainerColor = Color.Transparent,
            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, cursorColor = vb.accent,
        ),
    )
}
