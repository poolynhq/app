/**
 * Short labels for Activity (notifications inbox). Server titles/bodies stay verbose for email/push;
 * the app shows compact copy here.
 */

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trim()}…`;
}

export type ActivitySummary = { title: string; body: string | null };

export function summarizeActivityNotification(input: {
  type: string;
  title: string;
  body: string | null;
}): ActivitySummary {
  const { type, title, body } = input;
  const b = body?.trim() ?? "";

  switch (type) {
    case "network_join_invite":
      return { title: "Workplace invite", body: "Someone invited you to join their org on Poolyn." };
    case "ride_request_pending":
      return { title: "Pickup request for you", body: "A colleague needs a ride. Open Respond on My Rides." };
    case "ride_request_accepted":
      return { title: "Driver matched", body: "Your pickup was accepted. Open My Rides for details." };
    case "ride_request_expired":
      return { title: "Pickup timed out", body: "No driver matched in time. Post again when you are ready." };
    case "adhoc_seat_request":
      return { title: "Seat request", body: "A rider asked for a seat on your dated trip." };
    case "adhoc_seat_accepted":
      return { title: "Seat confirmed", body: "Your seat request was accepted. Message in the ride thread." };
    case "adhoc_seat_declined":
      return { title: "Seat declined", body: "The driver could not take this request. Search for another trip." };
    case "adhoc_seat_cancelled":
      return { title: "Seat request cancelled", body: "This pending request was cancelled." };
    case "adhoc_passenger_cancelled_seat":
      return { title: "Rider cancelled", body: "A rider cancelled their seat on your trip." };
    case "adhoc_driver_removed_you":
      return { title: "Removed from trip", body: "The driver removed you from this dated trip." };
    case "adhoc_trip_cancelled_by_driver":
      return { title: "Trip cancelled", body: "The driver cancelled this dated trip." };
    case "adhoc_you_cancelled_seat":
      return { title: "You left the trip", body: "You are no longer on this dated trip." };
    case "crew_trip_driver_started":
      return { title: "Crew trip started", body: "Your crew run started. Open Home when you are ready for pickup." };
    case "ride_contribution_updated":
      return { title: "Trip price updated", body: "Your share was recalculated (often when another rider joins)." };
    case "corridor_intro_request":
      return {
        title: "Route intro request",
        body: "Someone on your corridor wants to connect. Accept to open messages, or decline.",
      };
    case "corridor_intro_accepted":
      return { title: "Intro accepted", body: "You can open the message thread from Activity or Profile." };
    case "corridor_intro_declined":
      return { title: "Intro declined", body: "Your route intro was not accepted this time." };
    case "corridor_dm_message":
      return { title: "New corridor message", body: b ? truncate(b, 160) : "Open the thread to read it." };
    default:
      return {
        title: truncate(title || "Update", 52),
        body: b ? truncate(b, 160) : null,
      };
  }
}

export function shortActivityCta(input: {
  type: string;
}): string | null {
  switch (input.type) {
    case "network_join_invite":
      return "Tap: join org";
    case "ride_request_pending":
      return "Tap: My Rides, Respond";
    case "ride_request_accepted":
    case "ride_contribution_updated":
    case "adhoc_seat_request":
    case "adhoc_seat_accepted":
    case "adhoc_seat_declined":
    case "adhoc_seat_cancelled":
    case "adhoc_passenger_cancelled_seat":
    case "adhoc_driver_removed_you":
    case "adhoc_trip_cancelled_by_driver":
    case "adhoc_you_cancelled_seat":
      return "Tap: My Rides";
    case "crew_trip_driver_started":
      return "Tap: Home";
    case "corridor_intro_request":
      return "Use Accept or Decline";
    case "corridor_intro_accepted":
    case "corridor_dm_message":
      return "Tap: open messages";
    case "corridor_intro_declined":
      return "Tap to dismiss";
    default:
      return "Tap to open";
  }
}
