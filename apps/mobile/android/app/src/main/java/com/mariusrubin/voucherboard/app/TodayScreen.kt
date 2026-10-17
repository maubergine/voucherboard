package com.mariusrubin.voucherboard.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Today, as TodayScreen.swift: the zone and balance, Book a visitor and Scan, visits on now, the next 7 days, favourites. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(model: AppModel) {
    var today by remember { mutableStateOf<TodayView?>(null) }
    var cancelling by remember { mutableStateOf<Row?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(model.version) { today = model.view<TodayView>("today") }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { model.scope.launch { refreshing = true; model.act("load", args("keepPermits" to true)); refreshing = false } },
        modifier = Modifier.fillMaxSize(),
    ) {
        InsetList(contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 96.dp)) {
            item { LargeTitle("Today") }
            model.home?.let { home ->
                item {
                    Section(footer = home.updated.takeIf { it.isNotEmpty() }?.let { it.replaceFirstChar(Char::uppercase) }) {
                        Cell(first = true, padding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
                            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                StatusHeader(home)
                                if (largeText()) {
                                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                        PrimaryButton("Book a visitor") { model.book() }
                                        ScanMenu(model)
                                        if (home.demo == true) DemoTag()
                                        if (home.testMode) TestTag()
                                    }
                                } else {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        PrimaryButton("Book a visitor") { model.book() }
                                        ScanMenu(model)
                                        Spacer(Modifier.weight(1f))
                                        if (home.demo == true) DemoTag()
                                        if (home.testMode) TestTag()
                                    }
                                }
                            }
                        }
                    }
                }
                if (home.signedOut == true) item { SignedOutBanner(model) }
            }
            today?.let { t ->
                if (t.live.isNotEmpty()) item {
                    Section(header = "On now") {
                        t.live.forEachIndexed { i, l -> Cell(first = i == 0) { LiveCard(model, l) } }
                    }
                }
                item {
                    Section(header = "Next 7 days") {
                        if (t.next.isEmpty()) Cell(first = true) { Text("Nothing booked or planned for the next 7 days.", color = vb.secondary) }
                        t.next.forEachIndexed { i, row ->
                            RowSwipe(model, row, onCancel = { cancelling = it }) {
                                Cell(onClick = { model.open(row) }, first = i == 0 && t.next.isNotEmpty()) { RowView(row) }
                            }
                        }
                        if (t.more > 0) CellButton("${t.more} more in Calendar", first = t.next.isEmpty()) { model.tab = AppTab.Calendar }
                    }
                }
                if (t.favourites.isNotEmpty()) item {
                    Section(header = "Favourites") {
                        Row(
                            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            for (f in t.favourites) {
                                Column(
                                    Modifier.widthIn(min = 110.dp).clip(RoundedCornerShape(12.dp)).background(vb.fill)
                                        .clickable { model.book(Seed(vrns = listOf(f.vrn))) }
                                        .semantics(mergeDescendants = true) { contentDescription = "Book ${f.nick}" }
                                        .padding(10.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    PlateBadge(f.plate, 13f)
                                    Text(f.nick, style = Type.subheadline, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    CancelAlert(model, cancelling) { cancelling = null }
}

/** Scan a plate with the camera or from a photo, then book it. */
@Composable
fun ScanMenu(model: AppModel) {
    var open by remember { mutableStateOf(false) }
    Box(Modifier.semantics { contentDescription = "Scan a plate" }) {
        SecondaryButton("Scan") { open = true }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text("Scan with camera") }, leadingIcon = { Icon(Icons.Filled.CameraAlt, null) }, onClick = { open = false; model.scanToBook("camera") })
            DropdownMenuItem(text = { Text("Choose a photo") }, leadingIcon = { Icon(Icons.Filled.Photo, null) }, onClick = { open = false; model.scanToBook("photos") })
        }
    }
}

/** A visit in progress: how far through it is, and Extend. */
@Composable
fun LiveCard(model: AppModel, live: TodayView.Live) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PlateBadge(live.plate, 17f)
            if (live.name != live.plate) Text(live.name, style = Type.headline, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.weight(1f))
            PillView(Pill("On now", "live"))
        }
        LinearProgressIndicator(progress = { live.pct / 100f }, modifier = Modifier.fillMaxWidth(), color = vb.ok, trackColor = vb.fill)
        if (largeText()) {
            Text(live.time, style = Type.subheadline.merge(Mono))
            Text(live.vouchers, style = Type.subheadline, color = vb.text2)
            Text(live.ends, style = Type.subheadline, fontWeight = FontWeight.SemiBold)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(live.time, style = Type.subheadline.merge(Mono))
                Text("·", style = Type.subheadline, color = vb.text2, modifier = Modifier.clearAndSetSemantics {})
                Text(live.vouchers, style = Type.subheadline, color = vb.text2)
                Spacer(Modifier.weight(1f))
                Text(live.ends, style = Type.subheadline, fontWeight = FontWeight.SemiBold)
            }
        }
        Text(live.note, style = Type.footnote, color = vb.text2)
        AdaptiveStack(10.dp) {
            val x = live.extend
            if (live.canExtend && x != null) PrimaryButton("Extend") { model.book(Seed(extend = x)) }
            SecondaryButton("Details") { model.sheet = Sheet.Visit(live.key) }
        }
    }
}
