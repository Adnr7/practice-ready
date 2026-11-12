"use client";

import type { Reservation } from "@/components/reservations";
import { loadReservations, storeReservations } from "@/components/reservations";
import { refreshBackendReservations } from "@/lib/asmi-backend-adapter";

export type Participant = {
  userId?: number;
  email: string;
  name: string;
  status: "invited" | "accepted" | "declined" | "left";
  invitedAt: string;
  respondedAt?: string;
};

export type ParticipantAction = "invite" | "accept" | "decline" | "leave" | "remove";

export function normalEmail(value: string): string {
  return value.trim().toLowerCase();
}

interface ParticipantApiResponse {
  ownerId?: number | null;
  ownerEmail?: string;
  ownerName?: string;
  participants?: Participant[];
  error?: string;
}

/**
 * Applies a participation change through the backend. The reservation must be
 * linked to a backend booking (backendId); sample and legacy local records
 * cannot host joint practice.
 */
export async function updateParticipant(
  id: string,
  email: string,
  action: ParticipantAction,
): Promise<Reservation> {
  const all = loadReservations();
  const reservation = all.find((r) => r.id === id);
  if (!reservation || reservation.sample || reservation.cancelled || Date.parse(reservation.end) <= Date.now()) {
    throw Error("This session is no longer available for participation.");
  }
  if (!reservation.backendId) {
    throw Error("This session is not linked to an account. Book through Room availability to enable joint practice.");
  }

  const response = await fetch(`/api/bookings/${reservation.backendId}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, email: normalEmail(email) }),
  });
  const data = await response.json().catch(() => null) as ParticipantApiResponse | null;
  if (!response.ok || !data) {
    throw Error((data && typeof data.error === "string" && data.error) || "Could not update participation.");
  }

  const updated: Reservation = {
    ...reservation,
    ownerEmail: data.ownerEmail ?? reservation.ownerEmail,
    ownerName: data.ownerName ?? reservation.ownerName,
    participants: (data.participants ?? []).map((p) => ({
      email: p.email,
      name: p.name,
      status: p.status,
      invitedAt: p.invitedAt,
      ...(p.respondedAt ? { respondedAt: p.respondedAt } : {}),
    })),
  };
  storeReservations(all.map((r) => (r.id === id ? updated : r)));
  void refreshBackendReservations();
  return updated;
}
