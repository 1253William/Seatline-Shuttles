export type BookingErrorCode =
  | "TRIP_NOT_FOUND"
  | "SOLD_OUT"
  | "HOLD_NOT_FOUND"
  | "HOLD_EXPIRED"
  | "PAYMENT_NOT_CONFIGURED"
  | "PAYMENT_INITIALIZATION_FAILED"
  | "PAYMENT_FAILED"
  | "PAYMENT_MISMATCH"
  | "BOOKING_NOT_FOUND"
  | "INVALID_INPUT";

export type BookingError = {
  ok: false;
  code: BookingErrorCode;
  message: string;
  retryable: boolean;
  next_action: string;
};

export function bookingError(
  code: BookingErrorCode,
  message: string,
  nextAction: string,
  retryable = false,
): BookingError {
  return { ok: false, code, message, retryable, next_action: nextAction };
}

export function asError(error: BookingError) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(error, null, 2) }],
  };
}

export function asText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}
