package com.mariusrubin.voucherboard.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

private data class VehicleDest(val vrn: String)

/** Vehicles, as VehiclesScreen.swift: favourites and other vehicles, searchable; each opens its own page. */
@Composable
fun VehiclesScreen(model: AppModel, nav: Nav) {
    (nav.top as? VehicleDest)?.let { return VehicleScreen(model, it.vrn, onBack = { nav.pop() }) }
    var list by remember { mutableStateOf<VehiclesView?>(null) }
    var query by remember { mutableStateOf("") }
    var addOpen by remember { mutableStateOf(false) }
    LaunchedEffect(model.version, query) { list = model.view<VehiclesView>("vehicles", args("q" to query)) }

    Column(Modifier.fillMaxSize()) {
        LargeTitle("Vehicles") {
            Box {
                IconButton({ addOpen = true }) { Icon(Icons.Filled.Add, "Add", tint = vb.accent) }
                DropdownMenu(addOpen, { addOpen = false }) {
                    DropdownMenuItem(text = { Text("Book a visitor") }, leadingIcon = { Icon(Icons.Filled.DirectionsCar, null) }, onClick = { addOpen = false; model.book() })
                    DropdownMenuItem(text = { Text("New favourite") }, leadingIcon = { Icon(Icons.Filled.Star, null) }, onClick = { addOpen = false; model.sheet = Sheet.NewFavourite })
                }
            }
        }
        TextField(
            query, { query = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)),
            placeholder = { Text("Nickname or plate") },
            leadingIcon = { Icon(Icons.Filled.Search, null) },
            singleLine = true,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = vb.fill, unfocusedContainerColor = vb.fill,
                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            ),
        )
        InsetList(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 160.dp)) {
            item { SignedOutBanner(model) }
            list?.let { l ->
                if (l.favourites.isNotEmpty()) item { Section(header = "Favourites") { l.favourites.forEachIndexed { i, v -> VehicleRow(v, i == 0) { nav.push(VehicleDest(v.vrn)) } } } }
                if (l.others.isNotEmpty()) item { Section(header = "Other vehicles") { l.others.forEachIndexed { i, v -> VehicleRow(v, i == 0) { nav.push(VehicleDest(v.vrn)) } } } }
                if (l.favourites.isEmpty() && l.others.isEmpty()) item {
                    Section {
                        Cell(first = true) { Text(if (query.isEmpty()) "No vehicles yet. Book a visitor to add one." else "No vehicle matches.", color = vb.secondary) }
                    }
                }
            }
        }
    }
}

@Composable
private fun VehicleRow(v: VehiclesView.Item, first: Boolean, open: () -> Unit) {
    Cell(onClick = open, first = first) {
        Column(Modifier.weight(1f).padding(vertical = 2.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlateBadge(v.plate, 13f)
                if (v.name != v.plate) Text(v.name, style = Type.body, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(v.status.text, style = Type.footnote, color = if (v.status.tone == "live") vb.ok else vb.text2)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = vb.secondary)
    }
}

/** One vehicle: what's booked and planned, Book, and its favourite. */
@Composable
fun VehicleScreen(model: AppModel, vrn: String, onBack: () -> Unit) {
    var v by remember { mutableStateOf<VehicleView?>(null) }
    var nick by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    LaunchedEffect(model.version) {
        v = model.view<VehicleView>("vehicle", args("vrn" to vrn))
        if (nick.isEmpty()) v?.nick?.let { nick = it }
    }

    Pushed(v?.title ?: "", onBack) { pad ->
        InsetList(Modifier.padding(pad)) {
            v?.let { x ->
                item {
                    Section {
                        Cell(first = true) {
                            Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                PlateBadge(x.plate, 24f)
                                Text(x.subtitle, style = Type.subheadline, color = vb.secondary)
                            }
                        }
                        Cell { PrimaryButton(x.bookLabel, Modifier.fillMaxWidth(), large = true) { model.book(Seed(vrns = listOf(x.vrn))) } }
                    }
                }
                item {
                    Section(header = "Booked and planned") {
                        if (x.items.isEmpty()) Cell(first = true) { Text("Nothing booked or planned.", color = vb.secondary) }
                        x.items.forEachIndexed { i, row -> Cell(onClick = { model.open(row) }, first = i == 0) { RowView(row) } }
                    }
                }
                if (!x.fav) item {
                    Section(header = "Favourite", footer = "Favourites are saved on the council site, so they show on its own pages too.") {
                        Cell(first = true, padding = PaddingValues(0.dp)) {
                            TextField(
                                nick, { nick = it }, Modifier.fillMaxWidth(), placeholder = { Text("Nickname") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                                ),
                            )
                        }
                        CellButton(if (saving) "Saving…" else "Save as a favourite", enabled = nick.isNotBlank() && !saving) {
                            saving = true
                            model.scope.launch {
                                model.act("saveFavourite", args("vrn" to x.vrn, "nick" to nick, "isNew" to false))
                                saving = false
                            }
                        }
                    }
                }
                if (x.canDelete) item { Section { CellButton("Delete favourite", first = true, destructive = true) { confirmDelete = true } } }
            }
        }
    }
    if (confirmDelete) {
        ConfirmDialog(
            title = "Delete this favourite?",
            message = "It's removed from your favourites on the council site. Bookings stay as they are.",
            confirm = "Delete favourite", dismiss = "Cancel", onDismiss = { confirmDelete = false },
        ) {
            model.scope.launch {
                val r = model.act("deleteFavourite", args("vrn" to vrn))
                if (r.err == null) onBack()
            }
        }
    }
}
