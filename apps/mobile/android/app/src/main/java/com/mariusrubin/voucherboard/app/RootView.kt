package com.mariusrubin.voucherboard.app

import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The terms and sign-in gates, then the five tabs. A phone turned sideways shows the board instead, if the setting is on. As RootView.swift. */
@Composable
fun RootView(model: AppModel) {
    val config = LocalConfiguration.current
    // iOS shows the board when the height is compact: a phone on its side, with More > Turn sideways for the board on.
    val sideways = config.orientation == Configuration.ORIENTATION_LANDSCAPE && config.screenHeightDp < 500 && model.home?.rotateBoard == true
    Box(Modifier.fillMaxSize().background(vb.grouped)) {
        val home = model.home
        when (home?.phase) {
            "ready" -> if (sideways) BoardScreen(model, standalone = true) else MainTabs(model)
            "terms" -> TermsScreen(model)
            "signin" -> GateView(
                icon = Icons.Filled.Key, title = "Sign in to the council site",
                text = "Voucherboard books visitor parking vouchers on a Lewisham visitor permit. It isn't for resident permits. You sign in to your own council account on Lewisham's page. Voucherboard never sees or uses any of your login details.",
                button = "Sign in", secondary = "Try the demo", onSecondary = { model.launchAct("startDemo") },
            ) { model.launchAct("signIn") }
            "nopermit" -> GateView(
                icon = Icons.Filled.ConfirmationNumber, title = "No active visitor permit",
                text = "Voucherboard works only with active visitor permits, not resident permits. Buy visitor vouchers on the council site first.",
                button = "Open the council site",
            ) { model.launchAct("openCouncil") }
            "error" -> GateView(icon = Icons.Filled.Warning, title = "Couldn't load your permits", text = home.error ?: "", button = "Try again") {
                model.launchAct("load", args("keepPermits" to false))
            }
            else -> LoadingView()
        }

        val sheet = model.sheet
        BackHandler(enabled = sheet != null && sheet != Sheet.Run) { model.sheet = null }
        AnimatedVisibility(sheet != null, enter = slideInVertically { it }, exit = slideOutVertically { it }) {
            // Keeps the last sheet on screen while it slides away.
            val last = remember { arrayOfNulls<Sheet>(1) }
            if (sheet != null) last[0] = sheet
            last[0]?.let { SheetHost(model, it) }
        }
        ToastHost(model, bottom = if (sheet != null) 90.dp else if (home?.phase == "ready" && !sideways) (if (home.tray != null) 150.dp else 96.dp) else 24.dp)
    }
}

@Composable
fun LoadingView() {
    Column(Modifier.fillMaxSize().background(vb.grouped), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = vb.accent)
        Spacer(Modifier.height(14.dp))
        Text("Loading your permits", style = Type.subheadline, color = vb.secondary)
    }
}

@Composable
fun GateView(
    icon: ImageVector, title: String, text: String, button: String,
    secondary: String? = null, onSecondary: () -> Unit = {}, action: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(vb.grouped).statusBarsPadding(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 520.dp).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Icon(icon, null, Modifier.size(44.dp), tint = vb.accent)
            Text(title, style = Type.title2, textAlign = TextAlign.Center)
            Text(text, style = Type.body, color = vb.secondary, textAlign = TextAlign.Center)
            PrimaryButton(button, large = true, modifier = Modifier.padding(top = 6.dp), onClick = action)
            if (secondary != null) {
                SecondaryButton(secondary, large = true, onClick = onSecondary)
                Text("No account needed: the demo uses a made-up permit, and nothing is sent anywhere.", style = Type.footnote, color = vb.secondary, textAlign = TextAlign.Center)
            }
        }
    }
}

private data class TabItem(val tab: AppTab, val label: String, val icon: ImageVector)

private val TABS = listOf(
    TabItem(AppTab.Today, "Today", Icons.Filled.DirectionsCar),
    TabItem(AppTab.Calendar, "Calendar", Icons.Filled.CalendarMonth),
    TabItem(AppTab.List, "Bookings", Icons.Filled.Checklist),
    TabItem(AppTab.Vehicles, "Vehicles", Icons.AutoMirrored.Filled.ListAlt),
    TabItem(AppTab.More, "More", Icons.Filled.MoreHoriz),
)

@Composable
fun MainTabs(model: AppModel) {
    // One stack of pushed screens per tab, kept while switching tabs, as each tab's NavigationStack on iOS.
    val navs = remember { AppTab.entries.associateWith { Nav() } }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Box(Modifier.fillMaxSize().statusBarsPadding()) {
                when (model.tab) {
                    AppTab.Today -> TodayScreen(model)
                    AppTab.Calendar -> CalendarScreen(model, navs.getValue(AppTab.Calendar))
                    AppTab.List -> ListScreen(model)
                    AppTab.Vehicles -> VehiclesScreen(model, navs.getValue(AppTab.Vehicles))
                    AppTab.More -> MoreScreen(model, navs.getValue(AppTab.More))
                }
            }
            model.home?.tray?.let { tray ->
                // Hidden while ticking rows in Bookings, where the action bar takes its place.
                if (!(model.tab == AppTab.List && model.listSelecting)) {
                    Box(Modifier.align(Alignment.BottomCenter).padding(horizontal = 16.dp, vertical = 10.dp)) { TrayButton(model, tray) }
                }
            }
        }
        NavigationBar(containerColor = vb.card) {
            for (t in TABS) {
                val fs = LocalDensity.current.fontScale
                NavigationBarItem(
                    selected = model.tab == t.tab,
                    onClick = { if (model.tab == t.tab) navs.getValue(t.tab).stack.clear() else model.tab = t.tab },
                    icon = { Icon(t.icon, null) },
                    // Five labels fit only up to 130% text, so they stop growing there; TalkBack reads them in full.
                    label = { Text(t.label, maxLines = 1, fontSize = (12f * minOf(fs, 1.3f) / fs).sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = vb.accent, selectedTextColor = vb.accent, indicatorColor = vb.soft),
                )
            }
        }
    }
}

/** The plan, when there is one: a floating bar above the tabs. */
@Composable
private fun TrayButton(model: AppModel, tray: HomeView.Tray) {
    Surface(
        Modifier.widthIn(max = 560.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp))
            .clickable { model.sheet = Sheet.Plan }
            .semantics(mergeDescendants = true) { contentDescription = "${tray.title}. Shows your plan" },
        shape = RoundedCornerShape(22.dp), color = vb.card, shadowElevation = 6.dp, tonalElevation = 2.dp,
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(if (tray.ready) Icons.Filled.Checklist else Icons.Filled.ErrorOutline, null, tint = if (tray.ready) vb.accent else vb.bad)
            Column(Modifier.weight(1f)) {
                Text(tray.title, style = Type.subheadline, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(tray.subtitle, style = Type.caption, color = vb.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Filled.KeyboardArrowUp, null, tint = vb.secondary)
        }
    }
}

/** The zone, its controls and the voucher balance, at the top of Today. */
@Composable
fun StatusHeader(home: HomeView) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AdaptiveStack(12.dp, Modifier.semantics(mergeDescendants = true) {}) {
            // The badge grows with the text (42dp at the default size), and widens for a longer zone code.
            val badge = with(LocalDensity.current) { 42.dp * fontScale }
            Box(
                Modifier.sizeIn(minWidth = badge, minHeight = badge).clip(RoundedCornerShape(10.dp)).background(vb.accent)
                    .padding(horizontal = if (home.zone.code.length > 2) 6.dp else 0.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(home.zone.code, style = Type.title3, fontWeight = FontWeight.Black, color = vb.onAccent)
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(home.zone.name, style = Type.headline)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Dot(if (home.zone.live) vb.ok else vb.secondary)
                    Text(home.zone.text, style = Type.subheadline, color = vb.text2)
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (home.vouchers?.isNotEmpty() == true) Text("Unused vouchers", style = Type.caption, color = vb.text2)
            VoucherTiles(home.vouchers ?: emptyList(), home.balance)
        }
    }
}

/** Unused vouchers as one tile per type: the count large, the type beneath. */
@Composable
fun VoucherTiles(vouchers: List<HomeView.Vouchers>, empty: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        if (vouchers.isEmpty()) Text(empty, style = Type.subheadline, color = vb.text2)
        for (v in vouchers) {
            Column(
                Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(vb.soft).padding(vertical = 6.dp)
                    .semantics(mergeDescendants = false) { contentDescription = "${v.n} unused ${v.label} ${if (v.n == 1) "voucher" else "vouchers"}" },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("${v.n}", style = Type.title3.merge(Mono), fontWeight = FontWeight.Bold, color = vb.accent)
                Text(v.label, style = Type.caption, color = vb.text2, textAlign = TextAlign.Center)
            }
        }
    }
}

/** One host for every sheet, so a new sheet replaces the one before. */
@Composable
fun SheetHost(model: AppModel, sheet: Sheet) {
    Box(Modifier.fillMaxSize().background(vb.grouped)) {
        when (sheet) {
            is Sheet.Quick -> QuickBookSheet(model, sheet.start)
            Sheet.Plan -> PlanSheet(model)
            is Sheet.Entry -> EntrySheet(model, sheet.id)
            is Sheet.Visit -> VisitSheet(model, sheet.key)
            is Sheet.Bulk -> BulkSheet(model, sheet.keys)
            is Sheet.BulkTime -> BulkTimeSheet(model, sheet.keys)
            Sheet.Run -> RunSheet(model)
            Sheet.NewFavourite -> NewFavouriteSheet(model)
        }
    }
}
