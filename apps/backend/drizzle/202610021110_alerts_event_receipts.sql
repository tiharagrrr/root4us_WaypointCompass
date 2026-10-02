CREATE TABLE "alert_event_receipts" (
	"eventId" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"handledAt" timestamp with time zone DEFAULT now() NOT NULL
);
