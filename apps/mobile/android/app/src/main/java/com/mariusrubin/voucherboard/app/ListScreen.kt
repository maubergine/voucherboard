package com.mariusrubin.voucherboard.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.abs

/** A vehicle the Bookings tab shows only. */
private data class VehicleToken(val vrn: String, val plate: String, val name: String?) {
    constructor(v: ListView.Vehicle) : this(v.vrn, v.plate, if (v.name == v.plate) null else v.name)
}

/**
 * Bookings, as ListScreen.swift: every booking and planned item. Select to tick several, then change their times or
 * cancel and remove them together.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListScreen(model: AppModel) {
    var list by remember { mutableStateOf<ListView?>(null) }
    // Vehicles to show only, as chips above the list like the extension's "Show only".
    var shown by remember { mutableStateOf(listOf<VehicleToken>()) }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("date") }
    var past by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf<Row?>(null) }
    var bulk by remember { mutableStateOf<BulkView?>(null) }
    var sortOpen by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val keys = model.listSelection.sorted()

    LaunchedEffect(model.version, shown.map { it.vrn }, sort, past) {
        list = model.view<ListView>("list", args("vrns" to shown.map { it.vrn }, "sort" to sort, "past" to past))
        list?.let { l -> model.listSelection = model.listSelection intersect l.rows.filter { it.pick }.map { it.sel }.toSet() }
    }

    // Vehicles in the list that match what's typed, by name or plate, and aren't chips already.
    val matches = run {
        val q = query.trim()
        val vs = list?.vehicles
        if (q.isEmpty() || vs == null) emptyList() else {
            val plateQ = q.replace(" ", "").uppercase()
            vs.filter { v -> shown.none { it.vrn == v.vrn } && (v.name.contains(q, ignoreCase = true) || v.vrn.contains(plateQ)) }
        }
    }
    fun addChip(v: ListView.Vehicle) { shown = shown + VehicleToken(v); query = "" }

    Column(Modifier.fillMaxSize()) {
        LargeTitle("Bookings") {
            Box {
                IconButton({ sortOpen = true }) {
                    Icon(Icons.Filled.SwapVert, "Sort", tint = if (sort == "date" && !past) vb.accent else vb.label)
                }
                DropdownMenu(sortOpen, { sortOpen = false }) {
                    for ((id, label) in listOf("date" to "Sort by date", "name" to "Sort by name")) {
                        DropdownMenuItem(text = { Text(label) }, leadingIcon = { RadioButton(sort == id, null) }, onClick = { sort = id; sortOpen = false })
                    }
                    DropdownMenuItem(text = { Text("Show finished") }, leadingIcon = { Checkbox(past, null) }, onClick = { past = !past; sortOpen = false })
                }
            }
            BarButton(if (model.listSelecting) "Done" else "Select") {
                val on = !model.listSelecting
                model.endListSelect()
                model.listSelecting = on
            }
        }
        SearchField(query, { query = it }, if (shown.isEmpty()) "Show only a name or plate" else "Add another name or plate") {
            matches.firstOrNull()?.let(::addChip)
        }
        Box(Modifier.weight(1f)) {
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { model.scope.launch { refreshing = true; model.act("load", args("keepPermits" to true)); refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                InsetList(contentPadding = PaddingValues(bottom = if (model.listSelecting) 96.dp else 160.dp)) {
                    if (matches.isNotEmpty()) item {
                        Section {
                            matches.forEachIndexed { i, v ->
                                Cell(onClick = { addChip(v) }, first = i == 0) {
                                    if (v.name != v.plate) Text(v.name, style = Type.body)
                                    Spacer(Modifier.weight(1f))
                                    PlateBadge(v.plate, 12f)
                                }
                            }
                        }
                    }
                    item { SignedOutBanner(model) }
                    if (shown.isNotEmpty()) item { Chips(shown, remove = { t -> shown = shown.filter { it.vrn != t.vrn } }, clear = { shown = emptyList() }) }
                    list?.let { l ->
                        item {
                            Section(header = l.note.takeIf { it.isNotEmpty() }, footer = l.summary) {
                                if (l.rows.isEmpty()) Cell(first = true) { Text(l.empty, color = vb.secondary) }
                                l.rows.forEachIndexed { i, it ->
                                    if (model.listSelecting) {
                                        // Tapping ticks the row here, so it isn't a button.
                                        val on = it.sel in model.listSelection
                                        Cell(onClick = {
                                            model.listSelection = if (on) model.listSelection - it.sel else model.listSelection + it.sel
                                        }, first = i == 0, enabled = it.pick) {
                                            Icon(
                                                if (on) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, null,
                                                tint = if (on) vb.accent else vb.secondary, modifier = Modifier.alpha(if (it.pick) 1f else 0.45f),
                                            )
                                            Spacer(Modifier.width(12.dp))
                                            Box(Modifier.weight(1f).alpha(if (it.pick) 1f else 0.45f).semantics {
                                                stateDescription = if (on) "Selected" else "Not selected"
                                                it.why?.let { w -> contentDescription = w }
                                            }) { RowView(it.row) }
                                        }
                                    } else {
                                        RowSwipe(model, it.row, onCancel = { r -> cancelling = r }) {
                                            Cell(onClick = { model.open(it.row) }, first = i == 0) { RowView(it.row) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (model.listSelecting) {
                Box(Modifier.align(Alignment.BottomCenter).padding(horizontal = 16.dp, vertical = 8.dp)) {
                    ActionBar(model, keys) { k -> model.scope.launch { bulk = model.view<BulkView>("bulk", args("keys" to k)) } }
                }
            }
        }
    }
    CancelAlert(model, cancelling) { cancelling = null }
    bulk?.let { b ->
        ConfirmDialog(
            title = "${b.action}?",
            message = if (b.cancels) "Cancelling goes to the council site straight away. Cancelled vouchers go back to your unused vouchers." else null,
            confirm = if (b.cancels) "Yes, cancel" else "Yes, remove", dismiss = "Keep", onDismiss = { bulk = null },
        ) {
            val k = keys
            model.scope.launch {
                model.act("bulkApply", args("keys" to k), progress = if (b.cancels) "Cancelling…" else null)
                model.endListSelect()
            }
        }
    }
}

@Composable
private fun Chips(shown: List<VehicleToken>, remove: (VehicleToken) -> Unit, clear: () -> Unit) {
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        for (t in shown) {
            Row(
                Modifier.clip(CircleShape).background(vb.soft).clickable { remove(t) }
                    .semantics(mergeDescendants = true) { contentDescription = "Stop showing only ${t.name ?: t.plate}" }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                t.name?.let { Text(it, style = Type.subheadline, fontWeight = FontWeight.SemiBold) }
                PlateBadge(t.plate, 11f)
                ChipClose()
            }
        }
        if (shown.size > 1) BarButton("Clear", onClick = clear)
    }
}

@Composable
private fun ActionBar(model: AppModel, keys: List<String>, ask: (List<String>) -> Unit) {
    val n = model.listSelection.size
    val books = model.listSelection.any { it.startsWith("b:") }
    Surface(Modifier.widthIn(max = 560.dp).fillMaxWidth(), shape = RoundedCornerShape(22.dp), color = vb.card, shadowElevation = 6.dp, tonalElevation = 2.dp) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("$n selected", style = Type.subheadline.merge(Mono), fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            SecondaryButton("Change time", enabled = n > 0) { model.sheet = Sheet.BulkTime(keys) }
            SecondaryButton(if (books) "Cancel" else "Remove", enabled = n > 0, tint = vb.bad) { ask(keys) }
        }
    }
}

/** A search field at the top of a tab, as iOS's .searchable. */
@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String, onSubmit: () -> Unit) {
    TextField(
        value, onChange,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)),
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Filled.Search, null) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = vb.fill, unfocusedContainerColor = vb.fill,
            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
        ),
    )
}

/** New times for the ticked items: all to one time, or each moved by some minutes. Bookings go into the plan as changes. */
@Composable
fun BulkTimeSheet(model: AppModel, keys: List<String>) {
    var mode by remember { mutableStateOf("set") }
    var from by remember { mutableIntStateOf(-1) }
    var to by remember { mutableIntStateOf(-1) }
    var shift by remember { mutableIntStateOf(15) }
    var v by remember { mutableStateOf<BulkTimesView?>(null) }
    val a = { args("keys" to keys, "mode" to mode, "from" to from, "to" to to, "shift" to shift) }

    LaunchedEffect(mode, from, to, shift) {
        v = model.view<BulkTimesView>("bulkTimes", a())
        val x = v
        if (from < 0 && x != null) { from = x.from; to = x.to }
    }

    SheetScaffold(
        title = "Change ${if (keys.size == 1) "1 time" else "${keys.size} times"}",
        onClose = { model.sheet = null },
        actions = {
            BarButton(v?.apply ?: "Apply", enabled = (v?.ok ?: 0) > 0) {
                val args = a()
                model.scope.launch {
                    val r = model.act("bulkMove", args)
                    if (r.err == null) { model.endListSelect(); model.sheet = null }
                }
            }
        },
    ) { pad ->
        InsetList(Modifier.padding(pad)) {
            item {
                Section(footer = "Nothing is sent until you review your plan.") {
                    Cell(first = true) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ChoiceChip("One time for all", mode == "set") { mode = "set" }
                            ChoiceChip("Move each", mode == "shift") { mode = "shift" }
                        }
                    }
                    if (mode == "set") {
                        val (rf, ru) = timeRanges(v?.limits)
                        Cell {
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                TimeMenu("From", maxOf(from, 0), rf, modifier = Modifier.weight(1f)) { m -> from = m; if (to <= m) to = minOf(m + 60, ru.last) }
                                TimeMenu("Until", maxOf(to, 0), ru, modifier = Modifier.weight(1f)) { to = it }
                            }
                        }
                    } else {
                        Cell {
                            Text(shiftText(shift), style = Type.body.merge(Mono), modifier = Modifier.weight(1f))
                            SecondaryButton("−", small = true, enabled = shift > -720) { shift -= 5 }
                            Spacer(Modifier.width(8.dp))
                            SecondaryButton("+", small = true, enabled = shift < 720) { shift += 5 }
                        }
                    }
                }
            }
            v?.let { x ->
                item {
                    Section {
                        Cell(first = true) { Text(x.text, style = Type.subheadline) }
                        for (b in x.bad) Cell { Text(b, style = Type.footnote, color = vb.secondary) }
                    }
                }
            }
        }
    }
}

private fun shiftText(shift: Int): String {
    if (shift == 0) return "No change"
    val m = abs(shift)
    val h = m / 60
    val r = m % 60
    val amount = if (h == 0) "$r min" else if (r == 0) "$h h" else "$h h $r min"
    return "$amount ${if (shift > 0) "later" else "earlier"}"
}
