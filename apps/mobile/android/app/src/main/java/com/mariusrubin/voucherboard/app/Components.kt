package com.mariusrubin.voucherboard.app

import android.app.UiModeManager
import android.graphics.Typeface
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.min

// Colours, the plate badge, pills, lists, sheets and controls. The same parts as the iOS app's Components.swift.

@Immutable
data class VbColors(
    val accent: Color, val ok: Color, val okSoft: Color, val bad: Color, val warnSoft: Color, val soft: Color,
    val past: Color, val grouped: Color, val card: Color, val label: Color, val secondary: Color,
    val fill: Color, val separator: Color,
    /** Vouchers in a booking that aren't running: white text on it is at least 4.5:1. */
    val upcoming: Color,
    /** Grey for text that carries information (times, notes), at least 4.5:1 where the system grey isn't. */
    val text2: Color,
    /** Text on an accent fill: white in light mode, navy on dark mode's light blue. */
    val onAccent: Color,
)

val LightVb = VbColors(
    accent = Color(0xff2b4972), ok = Color(0xff2f6b3a), okSoft = Color(0xffe1f1e3), bad = Color(0xffb3261e),
    warnSoft = Color(0xfffff4e0), soft = Color(0xffe3e9f2), past = Color(0xff5f6b78),
    grouped = Color(0xfff2f2f7), card = Color.White, label = Color(0xff111111), secondary = Color(0x993c3c43),
    fill = Color(0x1f767680), separator = Color(0x4a3c3c43),
    upcoming = Color(0xff3f6aa0), text2 = Color(0xff515a68), onAccent = Color.White,
)

val DarkVb = VbColors(
    accent = Color(0xff8fb0e0), ok = Color(0xff7cc489), okSoft = Color(0xff1f3a24), bad = Color(0xffff8a80),
    warnSoft = Color(0xff3a2e14), soft = Color(0xff26324a), past = Color(0xff5d6880),
    grouped = Color(0xff000000), card = Color(0xff1c1c1e), label = Color(0xffffffff), secondary = Color(0x99ebebf5),
    fill = Color(0x3d767680), separator = Color(0x99545458),
    upcoming = Color(0xff3d5a85), text2 = Color(0xffb4bccb), onAccent = Color(0xff14213a),
)

/** Stronger colours when Android's contrast setting is raised (Settings > Accessibility > Colour and motion > Contrast), as iOS's Increase Contrast. */
fun VbColors.high(dark: Boolean) = if (dark) copy(
    accent = Color(0xffbcd2f2), ok = Color(0xffa6e0b0), bad = Color(0xffffb4ac), soft = Color(0xff1a2336), text2 = Color(0xffdce2ea),
) else copy(
    accent = Color(0xff172b48), ok = Color(0xff1b4a25), bad = Color(0xff861a13), soft = Color(0xffd0d9e8), text2 = Color(0xff2c323d),
)

val LocalVb = staticCompositionLocalOf { LightVb }
val vb: VbColors @Composable get() = LocalVb.current

/** Light, dark or the system's choice (More > Appearance), as on iOS. */
@Composable
fun VoucherboardTheme(appearance: String, content: @Composable () -> Unit) {
    val dark = when (appearance) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
    val hi = highContrast()
    val c = (if (dark) DarkVb else LightVb).let { if (hi) it.high(dark) else it }
    val scheme = if (dark) darkColorScheme(
        primary = c.accent, onPrimary = Color(0xff0d1a2e), secondaryContainer = c.soft, onSecondaryContainer = c.label,
        background = c.grouped, surface = c.card, onSurface = c.label, onSurfaceVariant = c.secondary, error = c.bad,
        surfaceContainer = c.card, surfaceContainerHigh = Color(0xff2c2c2e), outlineVariant = c.separator,
    ) else lightColorScheme(
        primary = c.accent, onPrimary = Color.White, secondaryContainer = c.soft, onSecondaryContainer = c.accent,
        background = c.grouped, surface = c.card, onSurface = c.label, onSurfaceVariant = c.secondary, error = c.bad,
        surfaceContainer = c.card, surfaceContainerHigh = Color.White, outlineVariant = c.separator,
    )
    CompositionLocalProvider(LocalVb provides c) {
        MaterialTheme(colorScheme = scheme) {
            // Text outside a Surface takes this colour, so it follows light and dark too.
            CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides c.label, content = content)
        }
    }
}

/** Android 14's contrast setting at medium or high. Earlier versions have only "High contrast text", which Android applies itself. */
@Composable
fun highContrast(): Boolean {
    if (Build.VERSION.SDK_INT < 34) return false
    val ctx = LocalContext.current
    val ui = ctx.getSystemService(UiModeManager::class.java)
    var contrast by remember { mutableFloatStateOf(ui.contrast) }
    DisposableEffect(ui) {
        val l = UiModeManager.ContrastChangeListener { contrast = it }
        ui.addContrastChangeListener(ContextCompat.getMainExecutor(ctx), l)
        onDispose { ui.removeContrastChangeListener(l) }
    }
    return contrast >= 0.5f
}

/** The largest text sizes (Android's font size at 150% or more), where screens stack and lists replace grids, as iOS's accessibility sizes. */
@Composable
fun largeText(): Boolean = LocalDensity.current.fontScale >= 1.5f

/** A plate for TalkBack, character by character: "T U 4 4 V W X". */
fun spelt(plate: String): String = plate.filter { !it.isWhitespace() }.toList().joinToString(" ")

/** Side by side, or one above the other at the largest text sizes. */
@Composable
fun AdaptiveStack(spacing: Dp = 10.dp, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    if (largeText()) Column(modifier, verticalArrangement = Arrangement.spacedBy(spacing)) { content() }
    else Row(modifier, horizontalArrangement = Arrangement.spacedBy(spacing), verticalAlignment = Alignment.CenterVertically) { content() }
}

/** Reads the text out with TalkBack when it appears or changes, as for an error under a field (a polite live region). */
fun Modifier.announce(): Modifier = semantics { liveRegion = LiveRegionMode.Polite }

/** A section header TalkBack reads out when it appears, as when Change time, Cancel or End early opens it. */
@Composable
fun AnnouncedHeader(text: String) {
    Text(text, style = Type.footnote, color = vb.secondary, modifier = Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite })
}

/** Two controls of equal width side by side, or full width one above the other at the largest text sizes. */
@Composable
fun Equal(modifier: Modifier, spacing: Dp, first: @Composable (Modifier) -> Unit, second: @Composable (Modifier) -> Unit) {
    if (largeText()) Column(modifier, verticalArrangement = Arrangement.spacedBy(spacing)) { first(Modifier.fillMaxWidth()); second(Modifier.fillMaxWidth()) }
    else Row(modifier, horizontalArrangement = Arrangement.spacedBy(spacing)) { first(Modifier.weight(1f)); second(Modifier.weight(1f)) }
}

/** The system "remove animations" setting, Android's Reduce Motion. */
@Composable
fun reduceMotion(): Boolean {
    val ctx = LocalContext.current
    return remember { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

// ---------- text styles, named as on iOS ----------

object Type {
    val largeTitle = TextStyle(fontSize = 32.sp, fontWeight = FontWeight.Bold)
    val title2 = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold)
    val title3 = TextStyle(fontSize = 20.sp)
    val headline = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontSize = 17.sp)
    val subheadline = TextStyle(fontSize = 15.sp)
    val footnote = TextStyle(fontSize = 13.sp)
    val caption = TextStyle(fontSize = 12.sp)
    val caption2 = TextStyle(fontSize = 11.sp)
}

val Mono = TextStyle(fontFeatureSettings = "tnum")

// ---------- the plate badge and pills ----------

private val Condensed = FontFamily(Typeface.create("sans-serif-condensed", Typeface.BOLD))

/**
 * A number plate: a light badge with a blue band, in a narrow bold face, as on iOS and the web UI. It grows with the
 * font size up to `maxScale`, so a plate still fits on one line.
 */
@Composable
fun PlateBadge(plate: String, size: Float = 15f, modifier: Modifier = Modifier, maxScale: Float = 2.2f) {
    val fontScale = LocalDensity.current.fontScale
    val px = size * min(fontScale, maxScale)
    val s = px.dp
    // The text sets the badge's size and the stripe is drawn behind it, so a taller row can't stretch the badge.
    Text(
        plate, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = (px / fontScale).sp, letterSpacing = (px * 0.06f / fontScale).sp,
        color = Color(0xff111111), maxLines = 1, softWrap = false,
        modifier = modifier
            .wrapContentSize()
            .clip(RoundedCornerShape(4.dp))
            .background(Color(0xfff7f7f1))
            .drawBehind { drawRect(Color(0xff2b4972), size = Size((s * 0.42f).toPx(), this.size.height)) }
            .border(max(1.5f, size / 8).dp, Color(0xff1b2540), RoundedCornerShape(4.dp))
            .semantics(mergeDescendants = true) { contentDescription = "Plate " + spelt(plate) }
            .padding(start = s * 0.82f, end = s * 0.5f, top = s * 0.1f, bottom = s * 0.1f),
    )
}

@Composable
fun PillView(pill: Pill) {
    val (fg, bg) = when (pill.tone) {
        "live" -> vb.ok to vb.okSoft
        "past" -> vb.secondary to vb.fill
        "change" -> vb.bad to vb.bad.copy(alpha = 0.12f)
        else -> vb.accent to vb.soft
    }
    val accent = vb.accent
    Text(
        pill.text, style = Type.caption, fontWeight = FontWeight.ExtraBold, color = fg, maxLines = 1,
        modifier = Modifier
            .then(
                if (pill.tone == "plan") Modifier.dashedCapsule(accent) else Modifier.background(bg, CircleShape)
            )
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

fun Modifier.dashedCapsule(color: Color, radius: Dp? = null, width: Dp = 1.5.dp): Modifier = this.then(
    Modifier.drawBehind {
        val w = width.toPx()
        val r = radius?.toPx() ?: (size.height / 2)
        drawRoundRect(
            color, topLeft = Offset(w / 2, w / 2), size = Size(size.width - w, size.height - w), cornerRadius = CornerRadius(r, r),
            style = Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
        )
    }
)

/** A booking or planned entry in a list. At the largest text sizes the day goes above it. */
@Composable
fun RowView(row: Row, showDay: Boolean = true, modifier: Modifier = Modifier) {
    if (largeText()) {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (showDay) Text("${row.day} ${row.date}", style = Type.subheadline, fontWeight = FontWeight.Bold, color = if (row.day == "Today") vb.accent else vb.text2)
            PlateBadge(row.plate, 13f)
            if (row.name != row.plate) Text(row.name, style = Type.subheadline)
            Text(row.time, style = Type.subheadline.merge(Mono), color = vb.text2)
            PillView(row.pill)
        }
        return
    }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (showDay) {
            Column(Modifier.width(48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(row.day, style = Type.caption, fontWeight = FontWeight.Bold, color = if (row.day == "Today") vb.accent else vb.text2, maxLines = 1)
                Text(row.date, style = Type.caption2, color = vb.text2, maxLines = 1)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlateBadge(row.plate, 13f)
                if (row.name != row.plate) Text(row.name, style = Type.subheadline, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(row.time, style = Type.subheadline.merge(Mono), color = vb.text2)
        }
        PillView(row.pill)
    }
}

// ---------- grouped lists, as iOS's inset grouped style ----------

/** A scrolling page of sections on the grouped background. */
@Composable
fun InsetList(modifier: Modifier = Modifier, contentPadding: PaddingValues = PaddingValues(bottom = 24.dp), content: LazyListScope.() -> Unit) {
    LazyColumn(
        modifier.fillMaxSize().background(vb.grouped),
        state = rememberLazyListState(),
        contentPadding = contentPadding,
        content = content,
    )
}

/** A section: an optional header, rounded rows, an optional footer. Put rows in with Cell; dividers are drawn between them. */
@Composable
fun Section(
    header: String? = null,
    footer: String? = null,
    headerContent: (@Composable () -> Unit)? = null,
    footerContent: (@Composable () -> Unit)? = null,
    background: Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 18.dp)) {
        if (header != null || headerContent != null) {
            Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp)) {
                headerContent?.invoke() ?: Text(header!!, style = Type.footnote, color = vb.secondary, modifier = Modifier.semantics { heading() })
            }
        }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(background ?: vb.card), content = content)
        if (footer != null || footerContent != null) {
            Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp)) {
                CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides vb.secondary) {
                    footerContent?.invoke() ?: Text(footer!!, style = Type.footnote, color = vb.secondary)
                }
            }
        }
    }
}

/** One row of a section. Pass `first = true` for the first row, so no divider is drawn above it. */
@Composable
fun Cell(
    onClick: (() -> Unit)? = null,
    first: Boolean = false,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    padding: PaddingValues = PaddingValues(horizontal = 16.dp, vertical = 11.dp),
    content: @Composable RowScope.() -> Unit,
) {
    if (!first) HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp, color = vb.separator)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).then(modifier)
            .then(if (onClick != null) Modifier.clickable(enabled = enabled, onClick = onClick) else Modifier)
            .padding(padding),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** A tappable row with a label in the accent colour, or red for destructive actions. */
@Composable
fun CellButton(label: String, first: Boolean = false, destructive: Boolean = false, enabled: Boolean = true, icon: ImageVector? = null, onClick: () -> Unit) {
    Cell(onClick = onClick, first = first, enabled = enabled) {
        val color = (if (destructive) vb.bad else vb.accent).let { if (enabled) it else it.copy(alpha = 0.4f) }
        if (icon != null) { Icon(icon, null, tint = color, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)) }
        Text(label, style = Type.body, color = color)
    }
}

/** A label and value on one row, as LabeledContent. */
@Composable
fun LabeledRow(label: String, value: String, first: Boolean = false, mono: Boolean = false) {
    Cell(first = first) {
        Text(label, style = Type.body, modifier = Modifier.weight(1f))
        Text(value, style = if (mono) Type.body.merge(Mono) else Type.body, color = vb.secondary, textAlign = TextAlign.End)
    }
}

/** The big heading at the top of a tab, as iOS's large navigation title. */
@Composable
fun LargeTitle(text: String, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
    // At least as tall as a toolbar button, so a title sits at the same height on every tab, with or without one.
    Row(modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = Type.largeTitle, modifier = Modifier.weight(1f).semantics { heading() })
        trailing()
    }
}

// ---------- buttons ----------

/** The main action on a screen: a filled button. */
@Composable
fun PrimaryButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, large: Boolean = false, small: Boolean = false, icon: ImageVector? = null, onClick: () -> Unit) {
    Button(
        onClick, modifier.then(if (large) Modifier.heightIn(min = 50.dp) else Modifier), enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = vb.accent),
        contentPadding = if (small) PaddingValues(horizontal = 12.dp, vertical = 4.dp) else ButtonDefaults.ContentPadding,
    ) {
        // Beside the label, centred with it, as SwiftUI's Label in a button.
        if (icon != null) { Icon(icon, null, Modifier.size(if (small) 16.dp else 18.dp)); Spacer(Modifier.width(6.dp)) }
        Text(label, fontWeight = FontWeight.SemiBold, style = if (small) Type.footnote else Type.subheadline, maxLines = 1)
    }
}

@Composable
fun SecondaryButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, large: Boolean = false, small: Boolean = false, tint: Color? = null, icon: ImageVector? = null, onClick: () -> Unit) {
    FilledTonalButton(
        onClick, modifier.then(if (large) Modifier.heightIn(min = 50.dp) else Modifier), enabled = enabled,
        colors = ButtonDefaults.filledTonalButtonColors(containerColor = vb.soft, contentColor = tint ?: vb.accent),
        contentPadding = if (small) PaddingValues(horizontal = 12.dp, vertical = 4.dp) else ButtonDefaults.ContentPadding,
    ) {
        if (icon != null) { Icon(icon, null, Modifier.size(if (small) 16.dp else 18.dp)); Spacer(Modifier.width(6.dp)) }
        Text(label, fontWeight = FontWeight.SemiBold, style = if (small) Type.footnote else Type.subheadline, maxLines = 1)
    }
}

/** A chip that's on (filled) or off. */
@Composable
fun ChoiceChip(label: String, on: Boolean, onClick: () -> Unit) {
    if (on) PrimaryButton(label, small = true, onClick = onClick) else SecondaryButton(label, small = true, onClick = onClick)
}

// ---------- sheets ----------

/**
 * A sheet: full screen over the tabs, with Close, a title, actions and an optional bottom bar. Drawn in the activity's
 * window, not a dialog, so the council view and the camera scanner can still cover it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SheetScaffold(
    title: String,
    onClose: (() -> Unit)?,
    closeLabel: String = "Close",
    back: Boolean = false,
    actions: @Composable RowScope.() -> Unit = {},
    bottomBar: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        containerColor = vb.grouped,
        topBar = {
            TopAppBar(
                title = { Text(title, style = Type.headline, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    if (onClose != null) {
                        if (back) IconButton(onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                        else TextButton(onClose) { Text(closeLabel, color = vb.accent) }
                    }
                },
                actions = actions,
                colors = TopAppBarDefaults.topAppBarColors(containerColor = vb.grouped),
            )
        },
        bottomBar = { Box(Modifier.navigationBarsPadding().imePadding()) { bottomBar() } },
        content = content,
    )
}

/** A bar of full-width buttons at the bottom of a sheet. */
@Composable
fun BottomActions(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(vb.grouped).padding(horizontal = 20.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp), content = content,
    )
}

/** A text button for a top bar's trailing action. */
@Composable
fun BarButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    TextButton(onClick, enabled = enabled) { Text(label, fontWeight = FontWeight.SemiBold, color = if (enabled) vb.accent else vb.secondary) }
}

/** A stack of pushed screens inside a tab or sheet, as a NavigationStack. */
class Nav {
    val stack = mutableStateListOf<Any>()
    val top: Any? get() = stack.lastOrNull()
    fun push(x: Any) { stack.add(x) }
    fun pop() { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
}

/** A pushed screen: a top bar with Back and a title. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Pushed(title: String, onBack: () -> Unit, actions: @Composable RowScope.() -> Unit = {}, content: @Composable (PaddingValues) -> Unit) {
    BackHandler(onBack = onBack)
    Scaffold(
        containerColor = vb.grouped,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = { Text(title, style = Type.headline, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = actions,
                windowInsets = WindowInsets(0, 0, 0, 0),
                colors = TopAppBarDefaults.topAppBarColors(containerColor = vb.grouped),
            )
        },
        content = content,
    )
}

// ---------- toasts, banners, dialogs ----------

/**
 * The message after an action, with Undo when it can be undone, and Close when it stays until closed. A polite live
 * region, so TalkBack reads each message and error as it appears.
 */
@Composable
fun ToastView(toast: Toast, close: () -> Unit, undo: (Int) -> Unit) {
    Surface(
        Modifier.padding(horizontal = 16.dp).widthIn(max = 560.dp).fillMaxWidth(),
        shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, shadowElevation = 6.dp, tonalElevation = 2.dp,
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
                when {
                    toast.busy && toast.progress != null -> ProgressPie(toast.progress)
                    toast.busy -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = vb.accent)
                    else -> Icon(if (toast.error) Icons.Filled.Warning else Icons.Filled.CheckCircle, null, tint = if (toast.error) vb.bad else vb.ok)
                }
            }
            // At the largest text sizes, three lines at most, so it doesn't cover the screen.
            Text(
                toast.text, style = Type.subheadline, maxLines = if (largeText()) 3 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
            )
            toast.undo?.let { id -> TextButton({ undo(id) }) { Text("Undo", fontWeight = FontWeight.SemiBold, color = vb.accent) } }
            if (toast.sticky) IconButton(close, Modifier.size(32.dp)) { Icon(Icons.Filled.Close, "Close", tint = vb.accent) }
        }
    }
}

/** The toast over everything, sliding up from the bottom. */
@Composable
fun BoxScope.ToastHost(model: AppModel, bottom: Dp) {
    val t = model.toast
    AnimatedVisibility(
        t != null, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = bottom),
        enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut(),
    ) {
        var last by remember { mutableStateOf(t) }
        if (t != null) last = t
        last?.let { ToastView(it, close = { model.toast = null }) { id -> model.undo(id) } }
    }
}

/** A message across the top of a list: signed out, test mode, an error. */
@Composable
fun Banner(title: String, text: String = "", tone: Color = vb.warnSoft, action: Pair<String, () -> Unit>? = null) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 16.dp).clip(RoundedCornerShape(12.dp)).background(tone).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, style = Type.subheadline, fontWeight = FontWeight.SemiBold)
        if (text.isNotEmpty()) Text(text, style = Type.footnote, color = vb.secondary)
        action?.let { (label, run) -> PrimaryButton(label, small = true, onClick = run) }
    }
}

/** A question before something that can't be undone, as iOS's alert and confirmation dialog. */
@Composable
fun ConfirmDialog(
    title: String,
    message: String? = null,
    confirm: String,
    dismiss: String = "Keep",
    destructive: Boolean = true,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = message?.let { { Text(it) } },
        confirmButton = { TextButton({ onDismiss(); onConfirm() }) { Text(confirm, color = if (destructive) vb.bad else vb.accent, fontWeight = FontWeight.SemiBold) } },
        dismissButton = { TextButton(onDismiss) { Text(dismiss, color = vb.accent) } },
    )
}

/** A pie that fills as a cancel goes through its vouchers; the result's tick replaces it. */
@Composable
fun ProgressPie(value: Double) {
    val v by animateFloatAsState(value.toFloat().coerceIn(0f, 1f), tween(300), label = "pie")
    val accent = vb.accent
    Canvas(Modifier.size(20.dp).semantics { contentDescription = "${(value * 100).toInt()} percent done" }) {
        drawCircle(accent.copy(alpha = 0.35f), style = Stroke(1.5.dp.toPx()))
        val inset = 3.5.dp.toPx()
        drawArc(accent, -90f, 360f * v, true, topLeft = Offset(inset, inset), size = Size(size.width - 2 * inset, size.height - 2 * inset))
    }
}

// ---------- times ----------

/** Minutes after midnight as 24-hour time. */
fun hm(m: Int): String = "%02d:%02d".format((m / 60) % 24, m % 60)

/**
 * What the From and Until pickers offer: the controlled hours, since hours outside them need no voucher. Until
 * starts 15 minutes after `earliest` (now, for a booking that starts now).
 */
fun timeRanges(limits: Span?, earliest: Int = 0): Pair<IntRange, IntRange> {
    val f = limits?.f ?: 0
    val t = limits?.t ?: (23 * 60 + 55)
    val lo = min(max(f + 15, (earliest + 15 + 4) / 5 * 5), t)
    return (f..max(f, t - 15)) to (lo..t)
}

/** A typed time as minutes after midnight: "10:30", "10.30", "1030", "930" or "10". Null if it isn't one. */
fun parseTime(s: String): Int? {
    val t = s.trim()
    val parts = t.split(':', '.').filter { it.isNotEmpty() }
    val h: Int?
    val m: Int?
    if (parts.size == 2 && parts[1].length == 2 && (t.contains(':') || t.contains('.'))) { h = parts[0].toIntOrNull(); m = parts[1].toIntOrNull() }
    else if (parts.size == 1 && t.all { it.isDigit() } && t.length in 1..4) {
        h = (if (t.length > 2) t.dropLast(2) else t).toIntOrNull(); m = if (t.length > 2) t.takeLast(2).toIntOrNull() else 0
    } else return null
    if (h == null || m == null || h !in 0..23 || m !in 0..59) return null
    return h * 60 + m
}

/** A time chooser: tap for a field to type the time in, above hour and minute wheels in 5 minutes, within `range`. */
@Composable
fun TimePicker(label: String, value: Int, range: IntRange = 0..(23 * 60 + 55), enabled: Boolean = true, modifier: Modifier = Modifier, pick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(
        modifier.clip(RoundedCornerShape(12.dp)).background(vb.fill)
            .clickable(enabled = enabled) { open = true }
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$label ${hm(value)}" },
    ) {
        Text(label, style = Type.caption, color = vb.secondary)
        Text(hm(value), style = Type.title2.merge(Mono), fontWeight = FontWeight.SemiBold, color = if (enabled) vb.label else vb.secondary)
    }
    if (open) {
        TimeDialog(close = { open = false }) {
            TimeField(label, range, pick) { open = false }
            TimeWheels(value, range, pick)
        }
    }
}

/**
 * A day and a time together, as a start-to-end booking's start or end: tap for a day wheel above hour and minute
 * wheels, or type the time in. The day's controlled hours show under it.
 */
@Composable
fun DayTimePicker(label: String, day: String, minute: Int, days: List<DayOption>, modifier: Modifier = Modifier, pickDay: (String) -> Unit, pickTime: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val d = days.firstOrNull { it.dk == day }
    val dayText = d?.label ?: day
    val controls = d?.ctl ?: ""
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(vb.fill)
            .clickable { open = true }
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$label $dayText, ${hm(minute)}. $controls" },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = Type.caption, color = vb.secondary)
        Text("$dayText, ${hm(minute)}", style = Type.title3.merge(Mono), fontWeight = FontWeight.SemiBold)
        Text(controls, style = Type.caption, color = vb.text2)
    }
    if (open) {
        val all = 0..(23 * 60 + 55)
        TimeDialog(close = { open = false }) {
            Text(controls, style = Type.footnote, color = vb.secondary)
            TimeField(label, all, pickTime) { open = false }
            Wheel(days.map { it.label }, days.indexOfFirst { it.dk == day }, "Day", Modifier.fillMaxWidth()) { pickDay(days[it].dk) }
            TimeWheels(minute, all, pickTime)
        }
    }
}

/** The pickers' dialog: its controls apply as they change, and Done closes it. */
@Composable
private fun TimeDialog(close: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    AlertDialog(
        onDismissRequest = close,
        confirmButton = { TextButton(close) { Text("Done", color = vb.accent, fontWeight = FontWeight.SemiBold) } },
        text = { Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp), content = content) },
    )
}

/**
 * Type a time instead of spinning. A whole time ("10:30", "1030") is set as typed, which moves the wheels; Done on the
 * keyboard sets a shorter one ("930", "10") and closes. Outside `range`, it says what's allowed.
 */
@Composable
private fun TimeField(label: String, range: IntRange, pick: (Int) -> Unit, done: () -> Unit) {
    var text by remember { mutableStateOf("") }
    var bad by remember { mutableStateOf(false) }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            text,
            { s ->
                text = s
                bad = false
                val whole = s.any { it == ':' || it == '.' } || s.count { it.isDigit() } == 4
                val m = parseTime(s)
                if (whole && m != null) { if (m in range) pick(m) else bad = true }
            },
            placeholder = { Text("HH:MM", Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
            singleLine = true,
            textStyle = Type.title3.merge(Mono).copy(fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = {
                val m = parseTime(text)
                if (m != null && m in range) { bad = false; pick(m); done() } else bad = text.isNotEmpty()
            }),
            isError = bad,
            modifier = Modifier.width(180.dp).semantics { contentDescription = "Type ${label.lowercase()} time" },
        )
        if (bad) Text("Between ${hm(range.first)} and ${hm(range.last)}", style = Type.footnote, color = vb.bad, modifier = Modifier.announce())
    }
}

/** Hour and minute wheels, side by side, in 5 minutes. A time outside `range` (minutes after midnight) springs back inside it. */
@Composable
private fun TimeWheels(value: Int, range: IntRange, pick: (Int) -> Unit) {
    val hours = (range.first / 60)..(range.last / 60)
    val minutes = (0..55 step 5).toList()
    val h = (value / 60).coerceIn(hours)
    val set = { hour: Int, minute: Int -> pick((hour * 60 + minute).coerceIn(range)) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Wheel(hours.map { "%02d".format(it) }, h - hours.first, "Hour", Modifier.width(72.dp)) { set(hours.first + it, value % 60 / 5 * 5) }
        Text(":", style = Type.title3, fontWeight = FontWeight.SemiBold)
        Wheel(minutes.map { "%02d".format(it) }, value % 60 / 5, "Minute", Modifier.width(72.dp)) { set(h, minutes[it]) }
    }
}

/** A wheel of choices: it snaps to the one in the middle, which is picked when it stops. A tap picks a row too. */
@Composable
fun Wheel(labels: List<String>, index: Int, description: String, modifier: Modifier = Modifier, onPick: (Int) -> Unit) {
    val row = 36.dp
    val state = rememberLazyListState(initialFirstVisibleItemIndex = index.coerceAtLeast(0))
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val pickNow by androidx.compose.runtime.rememberUpdatedState(onPick)
    val current by androidx.compose.runtime.rememberUpdatedState(index)
    // The row nearest the middle, once a scroll has settled.
    val centred = {
        val info = state.layoutInfo
        val mid = (info.viewportStartOffset + info.viewportEndOffset) / 2
        info.visibleItemsInfo.minByOrNull { kotlin.math.abs(it.offset + it.size / 2 - mid) }?.index ?: current
    }
    LaunchedEffect(index) { if (index >= 0 && !state.isScrollInProgress && centred() != index) state.animateScrollToItem(index) }
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress }.collect { moving -> if (!moving) centred().let { if (it != current && it in labels.indices) pickNow(it) } }
    }
    Box(modifier.height(row * 5).semantics { contentDescription = "$description ${labels.getOrNull(index) ?: ""}" }) {
        Box(Modifier.align(Alignment.Center).fillMaxWidth().height(row).clip(RoundedCornerShape(8.dp)).background(vb.fill))
        LazyColumn(
            Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(vertical = row * 2),
            flingBehavior = rememberSnapFlingBehavior(state),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            items(labels.size) { i ->
                Box(
                    Modifier.fillMaxWidth().height(row).clickable { scope.launch { state.animateScrollToItem(i) }; pickNow(i) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        labels[i], style = Type.title3.merge(Mono), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        fontWeight = if (i == index) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (i == index) vb.label else vb.secondary,
                    )
                }
            }
        }
    }
}

// ---------- smart replans ----------

/**
 * A smart replan, in the plan or on Bookings: folded to its saving (and its countdown), opened with the disclosure
 * triangle. One that uses only vouchers held stands out, with a filled button; one that needs vouchers bought stays
 * plain. With a bar above it (`pickable`), it has a tick for Replan selected.
 */
@Composable
fun ReplanCard(model: AppModel, r: Replan, pickable: Boolean = false, first: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    val add = { adding = true; model.launchAct("applyReplan", args("vrn" to r.vrn)) { adding = false } }
    Cell(first = first, modifier = if (r.own) Modifier.background(vb.soft) else Modifier, padding = PaddingValues(0.dp)) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 16.dp, vertical = 10.dp)
                    .semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (pickable) {
                    val on = r.on == true
                    IconButton(
                        { model.launchAct("replanSelect", args("vrn" to r.vrn, "on" to !on)) },
                        Modifier.size(32.dp).semantics { contentDescription = "Choose ${r.name}'s smart replan"; selected = on },
                    ) { Icon(if (on) Icons.Filled.CheckCircle else Icons.Outlined.Circle, null, tint = vb.accent) }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (!pickable) ReplanTag(r.tag, r.own)
                    Text(r.title, style = Type.subheadline, fontWeight = FontWeight.SemiBold)
                    ReplanCountdown(r.startsAt, r.countdownText)
                }
                Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = vb.accent)
            }
            if (open) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(r.text, style = Type.footnote, color = vb.secondary)
                    r.note?.let { Text(it, style = Type.footnote, color = vb.secondary) }
                    if (r.own) PrimaryButton(r.button, small = true, enabled = !adding) { add() }
                    else SecondaryButton(r.button, small = true, enabled = !adding) { add() }
                }
            }
        }
    }
}

/** Above two or more smart replans: what replanning all of them (or the ticked ones) saves, and the button. */
@Composable
fun ReplanBarView(model: AppModel, bar: ReplanBar, first: Boolean = true) {
    var adding by remember { mutableStateOf(false) }
    val bg = if (bar.ok == false) vb.bad.copy(alpha = 0.1f) else vb.soft
    Cell(first = first, modifier = Modifier.background(bg)) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ReplanTag(bar.tag, true)
            Text(bar.title, style = Type.subheadline, fontWeight = FontWeight.SemiBold)
            bar.warning?.let { w ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Filled.Warning, null, Modifier.size(16.dp), tint = vb.bad)
                    Text(w, style = Type.footnote, fontWeight = FontWeight.SemiBold, color = vb.bad)
                }
            }
            bar.note?.let { Text(it, style = Type.footnote, color = vb.secondary) }
            PrimaryButton(bar.button, small = true, enabled = !adding && bar.ok != false) {
                adding = true
                model.launchAct("applyReplans", args("vrns" to bar.vrns)) { adding = false }
            }
        }
    }
}

@Composable
fun ReplanTag(text: String, own: Boolean) {
    Text(
        text.uppercase(), style = Type.caption2, fontWeight = FontWeight.ExtraBold, color = vb.onAccent,
        modifier = Modifier.clip(RoundedCornerShape(3.dp)).background(if (own) vb.accent else vb.past).padding(horizontal = 6.dp, vertical = 1.dp),
    )
}

/**
 * A smart replan's last 10 minutes, to the second. When its first booking starts it no longer holds: the engine works
 * everything out again then, and the views on screen are fetched again.
 */
@Composable
fun ReplanCountdown(startsAt: Double?, text: String?) {
    startsAt ?: return
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(startsAt) { while (true) { now = System.currentTimeMillis(); kotlinx.coroutines.delay(1000 - now % 1000) } }
    val s = kotlin.math.ceil((startsAt - now) / 1000.0).toInt()
    if (s in 1..600) {
        Text(
            "Its first booking starts in ${s / 60}:${"%02d".format(s % 60)}. ${text ?: ""}",
            style = Type.footnote.merge(Mono), fontWeight = FontWeight.SemiBold, color = vb.bad,
        )
    }
}

// ---------- swipe on a row ----------

/**
 * Swipe on a booking or planned row: remove a planned item, or cancel a booking after asking (`cancelling`). The row
 * springs back; the engine's change removes it, as rowSwipe on iOS.
 */
@Composable
fun RowSwipe(model: AppModel, row: Row, onCancel: (Row) -> Unit, content: @Composable () -> Unit) {
    val entry = row.kind == "entry" && row.id != null
    val can = entry || row.canCancel == true
    if (!can) return content()
    val label = if (entry) (if (row.pill.tone == "plan" && row.time.startsWith("Change")) "Drop" else "Remove") else "Cancel"
    SwipeAction(label) {
        if (entry) model.launchAct("removeEntry", args("id" to row.id)) else onCancel(row)
    }.let { it(content) }
}

/** A trailing swipe that runs `action` and springs back, with the action's name on red. */
@Composable
fun SwipeAction(label: String, action: () -> Unit): @Composable (@Composable () -> Unit) -> Unit = { content ->
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val state = rememberSwipeToDismissBoxState()
    SwipeToDismissBox(
        state,
        enableDismissFromStartToEnd = false,
        onDismiss = { v ->
            if (v == SwipeToDismissBoxValue.EndToStart) action()
            scope.launch { state.reset() }
        },
        backgroundContent = {
            Box(Modifier.fillMaxSize().background(vb.bad).padding(end = 20.dp), contentAlignment = Alignment.CenterEnd) {
                Text(label, color = Color.White, fontWeight = FontWeight.SemiBold)
            }
        },
    ) { Box(Modifier.background(vb.card)) { content() } }
}

/** "Cancel this booking?" for a row swiped to cancel, as cancelAlert on iOS. */
@Composable
fun CancelAlert(model: AppModel, row: Row?, onDone: () -> Unit) {
    row ?: return
    ConfirmDialog(
        title = "Cancel this booking?",
        message = "${row.plate}, ${row.day} ${row.date}, ${row.time}. ${row.cancelText ?: ""} This goes to the council site straight away.",
        confirm = "Cancel booking", dismiss = "Keep it", onDismiss = onDone,
    ) { row.key?.let { model.launchAct("cancelVisit", args("key" to it), progress = "Cancelling…") } }
}

/** Shown on every tab when the council has signed the user out. */
@Composable
fun SignedOutBanner(model: AppModel) {
    if (model.home?.signedOut == true) {
        Banner(
            "You've been signed out of the council site.", "Your plan is saved on this phone. Sign in again to carry on.",
            action = "Sign in again" to { model.launchAct("signIn") },
        )
    }
}

/** A chip's remove mark: an × in a filled circle (iOS: xmark.circle.fill). */
@Composable
fun ChipClose() = Icon(Icons.Filled.Cancel, null, Modifier.size(18.dp), tint = vb.secondary)

@Composable
fun SmallText(text: String, color: Color = vb.secondary, size: TextUnit = 13.sp, weight: FontWeight = FontWeight.Normal) =
    Text(text, fontSize = size, color = color, fontWeight = weight)

@Composable
fun Tag(text: String, fg: Color, bg: Color, description: String) {
    Text(
        text, style = Type.caption2, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.8.sp, color = fg,
        modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(bg).padding(horizontal = 8.dp, vertical = 3.dp)
            .semantics { contentDescription = description },
    )
}

val TestYellow = Color(0xfff2c94c)
val TestInk = Color(0xff1b2540)

@Composable
fun TestTag() = Tag("TEST MODE", TestInk, TestYellow, "Test mode is on")

@Composable
fun DemoTag() = Tag("DEMO", vb.accent, vb.accent.copy(alpha = 0.15f), "Demo: a made-up permit")

@Composable
fun Dot(color: Color, size: Dp = 8.dp, outline: Boolean = false) {
    Box(Modifier.size(size).then(if (outline) Modifier.border(BorderStroke(1.dp, color), CircleShape) else Modifier.background(color, CircleShape)))
}
