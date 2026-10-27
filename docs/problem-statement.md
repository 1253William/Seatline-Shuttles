# Problem statement

Seatline Shuttles is a fictional Ghanaian intercity shuttle operator used to demonstrate a WhatsApp booking workflow. The proposed customer journey is finding a published trip, reserving one seat briefly, paying through Paystack, and receiving a ticket only after the payment is verified server-side.

Manual booking through chat and payment screenshots creates delays, makes availability difficult to coordinate, and does not provide trustworthy payment confirmation. This project addresses the narrow transaction path while leaving refunds, cancellations, group bookings, and unrelated customer support to staff.

## Success criteria

- The assistant can search only trips in the published schedule.
- A seat cannot be actively allocated to two bookings.
- Unpaid holds expire after 10 minutes.
- Payment links and ticket references are tied to the correct booking and amount.
- Only Paystack-verified payments can confirm a booking.
- Errors provide a machine-readable code and a safe next action.

All route, fare, and passenger data in this demonstration is fictional.
