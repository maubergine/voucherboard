package com.mariusrubin.voucherboard.app

import android.graphics.Typeface
import android.text.Spanned
import android.text.style.BulletSpan
import android.text.style.StyleSpan
import android.text.style.URLSpan
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.core.text.HtmlCompat

private object TermsDest

/** As MoreScreen.swift. Terms is pushed on the tab's own stack. */
@Composable
fun MoreScreen(model: AppModel, nav: Nav) {
    if (nav.top == TermsDest) {
        Pushed("Terms", onBack = { nav.pop() }) { pad -> TermsText(model, accept = false, modifier = Modifier.padding(pad)) }
        return
    }
    var more by remember { mutableStateOf<MoreView?>(null) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var appearance by remember { mutableStateOf(model.host.appearance) }
    val uri = LocalUriHandler.current
    LaunchedEffect(model.version) { more = model.view("more") }

    InsetList(contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 120.dp)) {
        item { LargeTitle("More") }
        val m = more ?: return@InsetList
        item { SignedOutBanner(model) }
        if (m.demo == true) {
            item {
                Section(header = "Demo", footer = "You're trying Voucherboard with a made-up permit. Nothing is sent anywhere, and nothing is kept when you leave.") {
                    CellButton("Leave the demo", first = true) { model.launchAct("leaveDemo") }
                }
            }
        }
        if (m.permits.isNotEmpty() || m.permit != null || m.subzones.isNotEmpty()) {
            item {
                Section {
                    var n = 0
                    if (m.permits.isNotEmpty()) {
                        PickerCell("Visitor permit", m.permits.firstOrNull { it.selected }?.label ?: "", m.permits.map { it.id to it.label }, first = n++ == 0) {
                            model.launchAct("setPermit", args("id" to it))
                        }
                    } else m.permit?.let { p -> LabeledRow("Visitor permit", p, first = n++ == 0) }
                    if (m.subzones.isNotEmpty()) {
                        val cur = m.subzones.firstOrNull { it.selected }
                        PickerCell("Parking in", cur?.label ?: "Choose…", m.subzones.map { it.code to it.label }, first = n++ == 0) {
                            model.launchAct("setSubzone", args("code" to it))
                        }
                    }
                }
            }
        }
        item {
            Section(header = "Settings") {
                val s = m.settings
                fun set(key: String, v: Any) = model.launchAct("setSetting", args("key" to key, "value" to v))
                ToggleCell("Test mode", "Checks bookings with the council site without booking or using vouchers", s.testMode, first = true) { set("testMode", it) }
                ToggleCell("Experimental: end bookings early", "Adds End early to bookings in progress", s.betaLive) { set("betaLive", it) }
                ToggleCell("Email confirmations", "The council emails you for each voucher booked", s.emailAll) { set("emailAll", it) }
                ToggleCell("Reminders", "On this phone, before a voucher ends", s.reminders) { set("reminders", it) }
                // Android's Live Updates; iOS's Live Activity. Same setting.
                ToggleCell("Live Updates", "In the status bar and on the lock screen while a visitor is parked", s.liveActivity) { set("liveActivity", it) }
                if (s.liveActivity && model.host.liveBlocked) {
                    Cell {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Live Updates are off for Voucherboard in Android's settings, so you'll get a normal notification instead.", style = Type.footnote, color = vb.secondary)
                            SecondaryButton("Turn on in Settings", small = true) { model.host.openLiveSettings() }
                        }
                    }
                }
                ToggleCell("Turn sideways for the board", "Turning your phone sideways shows the board instead of the tabs", s.rotateBoard ?: false) { set("rotateBoard", it) }
                if (s.reminders) {
                    PickerCell("Remind me", "${s.lead} min before", m.leads.map { it.toString() to "$it min before" }) { set("lead", it.toInt()) }
                }
                PickerCell("Appearance", mapOf("auto" to "Automatic", "light" to "Light", "dark" to "Dark")[appearance] ?: "Automatic",
                    listOf("auto" to "Automatic", "light" to "Light", "dark" to "Dark")) { appearance = it; model.host.appearance = it }
            }
        }
        m.messageTimes?.takeIf { it.isNotEmpty() }?.let { times ->
            item {
                Section(header = "Accessibility", footer = "How long messages such as “2 booked” stay on screen. With TalkBack on, messages with Undo stay until you close them.") {
                    val cur = m.settings.messageTime ?: 1
                    PickerCell("Messages stay", times.firstOrNull { it.value == cur }?.label ?: "", times.map { it.value.toString() to it.label }, first = true) {
                        model.launchAct("setSetting", args("key" to "messageTime", "value" to it.toInt()))
                    }
                }
            }
        }
        item {
            Section {
                CellButton("Show council site", first = true) { model.launchAct("openCouncil") }
                CellButton("Terms") { nav.push(TermsDest) }
                if (m.supportUrl.isNotEmpty()) CellButton("Help and support") { uri.openUri(m.supportUrl) }
                if (m.privacyUrl.isNotEmpty()) CellButton("Privacy policy") { uri.openUri(m.privacyUrl) }
                m.accessibilityUrl?.takeIf { it.isNotEmpty() }?.let { u -> CellButton("Accessibility statement") { uri.openUri(u) } }
                if (m.issuesUrl.isNotEmpty()) CellButton("Report issue") { uri.openUri(m.issuesUrl) }
                if (m.hasReport) {
                    Cell(onClick = { model.launchAct("shareReport") }) {
                        Column {
                            Text("Share last error details", style = Type.body, color = vb.accent)
                            Text("Tokens are removed", style = Type.footnote, color = vb.secondary)
                        }
                    }
                }
                if (m.demo != true) CellButton("Sign out of council site", destructive = true) { confirmSignOut = true }
            }
        }
        item { Text(m.footer, style = Type.footnote, color = vb.secondary, modifier = Modifier.padding(horizontal = 32.dp, vertical = 12.dp)) }
    }
    if (confirmSignOut) {
        ConfirmDialog("Sign out of the council site?", "Your plan stays on this phone.", confirm = "Sign out", dismiss = "Keep", onDismiss = { confirmSignOut = false }) {
            model.launchAct("signOut")
        }
    }
}

@Composable
private fun ToggleCell(label: String, sub: String, on: Boolean, first: Boolean = false, set: (Boolean) -> Unit) {
    // The whole row is one switch for TalkBack, labelled by its text.
    Cell(first = first, modifier = Modifier.toggleable(on, role = Role.Switch, onValueChange = set)) {
        Column(Modifier.weight(1f).padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = Type.body)
            Text(sub, style = Type.footnote, color = vb.secondary)
        }
        Switch(on, null)
    }
}

/** A row showing a choice, with a menu of the others. */
@Composable
private fun PickerCell(label: String, value: String, options: List<Pair<String, String>>, first: Boolean = false, pick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Cell(onClick = { open = true }, first = first) {
        Text(label, style = Type.body, modifier = Modifier.weight(1f))
        Box {
            Text(value, style = Type.body, color = vb.secondary, textAlign = TextAlign.End)
            DropdownMenu(open, { open = false }) {
                for ((id, text) in options) DropdownMenuItem(text = { Text(text) }, onClick = { open = false; pick(id) })
            }
        }
    }
}

/** Shown until the current terms are accepted. */
@Composable
fun TermsScreen(model: AppModel) {
    var declined by remember { mutableStateOf(false) }
    if (declined) {
        GateView(
            icon = Icons.Filled.Description, title = "Voucherboard needs the terms accepted",
            text = "Nothing has been read from the council site. You can accept the terms whenever you're ready.",
            button = "Read the terms again",
        ) { declined = false }
    } else {
        SheetScaffold(title = "Voucherboard", onClose = null) { pad ->
            TermsText(model, accept = true, decline = { declined = true }, modifier = Modifier.padding(pad))
        }
    }
}

/** The terms (extension/src/terms.js), turned from HTML into text. */
@Composable
fun TermsText(model: AppModel, accept: Boolean, decline: () -> Unit = {}, modifier: Modifier = Modifier) {
    var text by remember { mutableStateOf<List<Paragraph>?>(null) }
    var privacy by remember { mutableStateOf<String?>(null) }
    var accepting by remember { mutableStateOf(false) }
    var agreed by remember { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    val linkColor = vb.accent
    LaunchedEffect(Unit) {
        if (text != null) return@LaunchedEffect
        val t = model.view<TermsView>("terms") ?: return@LaunchedEffect
        text = renderTerms(t.html, linkColor)
        privacy = t.privacyUrl
    }
    Column(modifier.fillMaxSize().background(vb.grouped)) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (accept) {
                Text("Before you start, read and accept the terms. Nothing is read from the council site until you do.", style = Type.subheadline, fontWeight = FontWeight.SemiBold)
            }
            val t = text
            if (t != null) {
                SelectionContainer {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (p in t) {
                            Text(p.text, style = Type.body, modifier = Modifier.padding(top = if (p.heading) 8.dp else 0.dp).then(if (p.heading) Modifier.semantics { heading() } else Modifier))
                        }
                    }
                }
                privacy?.let { u -> TextButton({ uri.openUri(u) }) { Text("Privacy policy", color = vb.accent) } }
            } else {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = vb.accent) }
            }
            if (accept && t != null) {
                // One control for TalkBack: a checkbox, on or off, labelled by the text.
                Row(Modifier.fillMaxWidth().toggleable(agreed, role = Role.Checkbox) { agreed = it }, verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Checkbox(agreed, null, colors = CheckboxDefaults.colors(checkedColor = vb.accent))
                    Text("I have read and accept these terms, and I understand that I use Voucherboard entirely at my own risk.", style = Type.subheadline, modifier = Modifier.padding(top = 12.dp))
                }
            }
        }
        if (accept) {
            Column(Modifier.fillMaxWidth().background(vb.card).navigationBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryButton(if (accepting) "Starting…" else "Accept and continue", Modifier.fillMaxWidth(), enabled = !accepting && agreed, large = true) {
                    accepting = true
                    model.launchAct("acceptTerms")
                }
                SecondaryButton("Don't accept", Modifier.fillMaxWidth(), large = true, onClick = decline)
            }
        }
    }
}

data class Paragraph(val text: AnnotatedString, val heading: Boolean)

/**
 * The terms are plain headings, paragraphs and lists. Each line of the rendered HTML becomes a paragraph; a short
 * paragraph that starts bold is a heading, as on iOS.
 */
fun renderTerms(html: String, linkColor: androidx.compose.ui.graphics.Color): List<Paragraph> {
    val sp = HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_COMPACT)
    val out = mutableListOf<Paragraph>()
    var start = 0
    val s = sp.toString()
    while (start <= s.length) {
        val end = s.indexOf('\n', start).let { if (it < 0) s.length else it }
        val line = s.substring(start, end)
        if (line.isNotBlank()) {
            val bullet = sp.getSpans(start, end, BulletSpan::class.java).isNotEmpty()
            val bold = sp.getSpans(start, start + 1, StyleSpan::class.java).any { it.style and Typeface.BOLD != 0 }
            out += Paragraph(annotated(sp, start, end, bullet, linkColor), bold && line.length < 80)
        }
        start = end + 1
    }
    return out
}

private fun annotated(sp: Spanned, start: Int, end: Int, bullet: Boolean, linkColor: androidx.compose.ui.graphics.Color): AnnotatedString = buildAnnotatedString {
    val off = if (bullet) 2 else 0
    if (bullet) append("• ")
    append(sp.substring(start, end))
    for (st in sp.getSpans(start, end, StyleSpan::class.java)) {
        val a = maxOf(sp.getSpanStart(st), start) - start + off
        val b = minOf(sp.getSpanEnd(st), end) - start + off
        if (a >= b) continue
        val bold = st.style and Typeface.BOLD != 0
        val italic = st.style and Typeface.ITALIC != 0
        addStyle(SpanStyle(fontWeight = if (bold) FontWeight.Bold else null, fontStyle = if (italic) FontStyle.Italic else null), a, b)
    }
    for (u in sp.getSpans(start, end, URLSpan::class.java)) {
        val a = maxOf(sp.getSpanStart(u), start) - start + off
        val b = minOf(sp.getSpanEnd(u), end) - start + off
        if (a >= b || !u.url.startsWith("https://")) continue
        addLink(LinkAnnotation.Url(u.url, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))), a, b)
    }
}
