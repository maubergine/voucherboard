package com.mariusrubin.voucherboard.app

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The engine's view models (apps/mobile/www/views.js), decoded as they come. The same shapes as the iOS app's
// Models.swift: text is already worded for the screen; times are minutes after midnight and days are YYYY-MM-DD keys.

@Serializable data class Pill(val text: String, val tone: String)
@Serializable data class Span(val f: Int, val t: Int)

/** A booking ("visit") or a planned entry, as listed on Today, the agenda and a vehicle's page. */
@Serializable
data class Row(
    val kind: String,
    val key: String? = null,
    val id: Int? = null,
    val dk: String,
    val day: String,
    val date: String,
    val vrn: String,
    val plate: String,
    val name: String,
    val time: String,
    val start: Int,
    val pill: Pill,
    /** Bookings only: whether it can be cancelled from the list, and what that gives back. */
    val canCancel: Boolean? = null,
    val cancelText: String? = null,
) {
    val rowID: String get() = if (kind == "visit") "b:" + (key ?: "") else "e:${id ?: 0}"
}

@Serializable
data class HomeView(
    val phase: String,
    val demo: Boolean? = null,
    val error: String? = null,
    val signedOut: Boolean? = null,
    val loading: Boolean? = null,
    val updated: String = "",
    val testMode: Boolean = false,
    val version: String? = null,
    val zone: Zone,
    val balance: String = "",
    val vouchers: List<Vouchers>? = null,
    val tray: Tray? = null,
    val running: Boolean = false,
    val busy: Boolean? = null,
    /** More > Settings: turning the phone sideways shows the board. Off by default. */
    val rotateBoard: Boolean? = null,
    /** More > Accessibility: how long messages stay, as a multiple of the usual time; 0 keeps them until closed. */
    val messageTime: Int? = null,
) {
    @Serializable data class Zone(val code: String, val name: String, val live: Boolean, val text: String)
    @Serializable data class Tray(val title: String, val short: String, val subtitle: String, val ready: Boolean)
    @Serializable data class Vouchers(val kind: String, val n: Int, val label: String)
}

@Serializable
data class TodayView(
    val live: List<Live>,
    val liveActivity: Boolean,
    val zone: String,
    val next: List<Row>,
    val more: Int,
    val total: Int,
    val favourites: List<Favourite>,
) {
    @Serializable
    data class Live(
        val key: String, val vrn: String, val plate: String, val name: String, val time: String, val vouchers: String, val ends: String,
        val pct: Int, val note: String, val canExtend: Boolean, val extend: Extend? = null, val canEndEarly: Boolean,
        /** Milliseconds from now to the start and end, for the Live Update (iOS: the Live Activity). */
        val startIn: Double, val endIn: Double,
        /** Each voucher's minutes, drawn as the Live Update's progress segments. */
        val spans: List<Span>? = null,
    ) {
        @Serializable data class Extend(val vrn: String, val dk: String, val end: Int)
    }
    @Serializable data class Favourite(val vrn: String, val nick: String, val plate: String)
}

@Serializable
data class CalendarView(val weekdays: List<String>, val days: List<Day>, val selected: Agenda) {
    @Serializable
    data class Day(
        val dk: String, val date: Int, val label: String, val off: Boolean, val today: Boolean, val selected: Boolean,
        val enabled: Boolean, val booked: Boolean, val planned: Boolean,
    )
}

@Serializable data class Agenda(val dk: String, val title: String, val ctl: String, val items: List<Row>, val bookable: Boolean)

@Serializable data class Hour(val min: Int, val label: String, val short: String)

@Serializable
data class Block(
    val kind: String,
    val key: String? = null,
    val id: Int? = null,
    val sel: String,
    val dayIndex: Int,
    val f: Int,
    val t: Int,
    val status: String,
    val changing: Boolean,
    val label: String,
    /** What TalkBack reads: day, plate spelt out, time and state. */
    val say: String? = null,
)

@Serializable data class Lane(val vrn: String, val plate: String, val name: String, val blocks: List<Block>)

@Serializable
data class DayTimeline(
    val dk: String, val title: String, val ctl: String, val bookable: Boolean, val prev: String, val next: String,
    val from: Int, val to: Int, val hours: List<Hour>, val controls: List<Span>, val now: Int? = null, val lanes: List<Lane>,
)

@Serializable
data class Board(
    val zoom: String, val label: String, val from: Int, val to: Int, val hours: List<Hour>, val days: List<Day>,
    val now: Now? = null, val prev: String? = null, val next: String? = null, val lanes: List<Lane>,
) {
    @Serializable data class Day(val dk: String, val label: String, val short: String? = null, val today: Boolean, val off: Boolean, val controls: List<Span>, val bookable: Boolean)
    @Serializable data class Now(val dayIndex: Int, val min: Int)
}

@Serializable
data class VehiclesView(val favourites: List<Item>, val others: List<Item>) {
    @Serializable data class Item(val vrn: String, val plate: String, val name: String, val status: Pill)
}

@Serializable
data class VehicleView(
    val vrn: String, val plate: String, val title: String, val subtitle: String, val fav: Boolean, val canDelete: Boolean,
    val nick: String, val bookLabel: String, val items: List<Row>,
)

@Serializable
data class Suggestions(val matches: List<Match>, val newVrn: String? = null, val newPlate: String? = null) {
    @Serializable data class Match(val vrn: String, val plate: String, val name: String, val nick: String)
}

@Serializable
data class PlanView(
    val items: List<Item>, val subtitle: String, val cost: String? = null, val ready: Boolean, val reviewLabel: String,
    val advice: Advice? = null, val empty: Boolean,
) {
    @Serializable
    data class Item(
        val id: Int, val dk: String, val day: String, val date: String, val vrn: String, val plate: String, val change: Boolean,
        val time: String, val need: String, val bad: String? = null, val start: Int,
    )
    @Serializable
    data class Advice(val tone: String, val title: String, val text: String, val buys: List<Buy>) {
        @Serializable data class Buy(val kind: String, val n: Int, val label: String)
    }
}

@Serializable
data class EntryView(
    val id: Int, val vrn: String, val plate: String, val name: String, val title: String, val dayText: String, val ctl: String,
    val limits: Span? = null, val from: Int, val to: Int, val cost: String? = null, val notes: List<Note>, val removeLabel: String,
) {
    @Serializable data class Note(val tone: String, val text: String)
}

@Serializable
data class VisitView(
    val key: String, val vrn: String, val plate: String, val name: String, val status: String, val statusText: String,
    val dayText: String, val time: String, val start: Int, val end: Int, val limits: Span? = null, val vouchersText: String,
    val vouchers: List<Voucher>, val refs: String, val canCancel: Boolean, val canChange: Boolean, val note: String,
    val cancelText: String, val canEndEarly: Boolean, val shrink: List<Shrink>, val keepLabel: String,
) {
    @Serializable data class Voucher(val label: String, val running: Boolean, val past: Boolean)
    @Serializable data class Shrink(val index: Int, val end: String, val returns: String)
}

/** Every booking and planned item (`list`). Each row is a `Row`, plus its bulk key and whether it can be picked. */
@Serializable
data class ListView(val rows: List<Item>, val vehicles: List<Vehicle>, val summary: String, val note: String = "", val empty: String) {
    /** The engine sends the row's fields and `sel`, `pick`, `why` side by side; ListItemSerializer splits them. */
    @Serializable(with = ListItemSerializer::class)
    data class Item(val row: Row, val sel: String, val pick: Boolean, val why: String? = null)
    @Serializable data class Vehicle(val vrn: String, val plate: String, val name: String, val on: Boolean)
}

/** What a bulk time change would do (`bulkTimes`). */
@Serializable
data class BulkTimesView(val from: Int, val to: Int, val limits: Span? = null, val ok: Int, val text: String, val bad: List<String>, val apply: String)

@Serializable
data class BulkView(val title: String, val items: List<Item>, val note: String, val action: String, val cancels: Boolean, val single: String? = null) {
    @Serializable data class Item(val plate: String, val text: String, val pill: String)
}

/** The quick-book form. Native keeps it and hands it back with every quick-book call. */
@Serializable
data class QuickForm(val vrns: List<String>, val `when`: String, val days: List<String>, val from: Int, val to: Int, val preset: String)

@Serializable
data class QuickView(
    val q: QuickForm, val `when`: String, val presets: List<Preset>, val days: Days? = null, val from: Int, val to: Int,
    val fromText: String, val toText: String, val fromEditable: Boolean, val limits: Span? = null, val note: String,
    val vehicles: List<Vehicle>, val preview: Preview,
) {
    @Serializable data class Preset(val id: String, val label: String, val on: Boolean)
    @Serializable
    data class Days(val choices: List<Choice>, val days: List<Day>, val count: Int) {
        @Serializable data class Choice(val id: String, val label: String)
        @Serializable data class Day(val dk: String, val date: Int, val label: String, val off: Boolean, val today: Boolean, val on: Boolean, val enabled: Boolean)
    }
    @Serializable data class Vehicle(val vrn: String, val plate: String, val name: String)
    @Serializable data class Preview(val text: String, val notes: List<String>, val ok: Boolean, val bad: Boolean, val canAdd: Boolean, val canBook: Boolean)
}

@Serializable
data class ConfirmView(
    val plate: String? = null, val name: String? = null, val plates: List<String>, val dayLabel: String, val dayText: String,
    val timeText: String, val vouchersText: String, val email: Boolean, val test: Boolean, val note: String, val goLabel: String,
)

@Serializable
data class RunView(
    val phase: String, val test: Boolean, val title: String, val tag: String, val balance: String, val heading: String, val goLabel: String,
    val progress: Int, val label: String, val stopping: Boolean, val ops: List<Op>, val info: String, val modeNote: String, val note: String,
    val failed: Boolean, val ok: Boolean, val reminder: String? = null, val canResume: Boolean, val hasReport: Boolean,
) {
    @Serializable
    data class Op(val kind: String, val tag: String, val plate: String, val text: String, val status: String, val statusText: String, val err: String? = null) {
        val id: String get() = plate + text + tag
    }
}

@Serializable
data class MoreView(
    val permits: List<Permit>, val subzones: List<Subzone>, val settings: Settings, val leads: List<Int>, val hasReport: Boolean,
    val issuesUrl: String, val footer: String, val demo: Boolean? = null, val privacyUrl: String, val supportUrl: String,
    val accessibilityUrl: String? = null, val messageTimes: List<MessageTime>? = null,
    /** The selected visitor permit, shown even when there's only one. */
    val permit: String? = null,
) {
    @Serializable data class Permit(val id: String, val label: String, val selected: Boolean)
    @Serializable data class Subzone(val code: String, val label: String, val selected: Boolean)
    @Serializable
    data class Settings(val testMode: Boolean, val betaLive: Boolean, val emailAll: Boolean, val reminders: Boolean, val lead: Int, val liveActivity: Boolean,
        val rotateBoard: Boolean? = null, val messageTime: Int? = null,
    )
    @Serializable data class MessageTime(val value: Int, val label: String)
}

@Serializable data class TermsView(val html: String, val version: String, val owner: String, val privacyUrl: String? = null)

/** What an action returns: a message to show, an undo id, or an error. Scans also return plates. */
@Serializable
data class ActionResult(
    val toast: String? = null,
    val undo: Int? = null,
    val err: String? = null,
    val cancelled: Boolean? = null,
    val cands: List<Candidate>? = null,
    val vrn: String? = null,
) {
    @Serializable data class Candidate(val vrn: String, val plate: String, val name: String? = null)
}

/** A list row: the row's own fields, with `sel`, `pick` and `why` beside them (as ListView.Item decodes on iOS). */
object ListItemSerializer : KSerializer<ListView.Item> {
    override val descriptor = JsonObject.serializer().descriptor

    override fun deserialize(decoder: Decoder): ListView.Item {
        val input = decoder as JsonDecoder
        val o = input.decodeJsonElement().jsonObject
        return ListView.Item(
            row = input.json.decodeFromJsonElement(Row.serializer(), o),
            sel = o.getValue("sel").jsonPrimitive.content,
            pick = o.getValue("pick").jsonPrimitive.boolean,
            why = o["why"]?.jsonPrimitive?.contentOrNull,
        )
    }

    override fun serialize(encoder: Encoder, value: ListView.Item) = throw UnsupportedOperationException("decode only")
}
