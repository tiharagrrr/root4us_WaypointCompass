CREATE TABLE "load_event_receipts" (
	"eventId" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"handledAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "load_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tripId" uuid NOT NULL,
	"checkedByName" text NOT NULL,
	"releasedById" text,
	"deviceId" text,
	"releaseTempC" double precision,
	"planRevision" integer NOT NULL,
	"clientUuid" uuid NOT NULL,
	"releasedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "load_releases_tripId_unique" UNIQUE("tripId"),
	CONSTRAINT "load_releases_clientUuid_unique" UNIQUE("clientUuid"),
	CONSTRAINT "load_releases_temp_chk" CHECK ("load_releases"."releaseTempC" IS NULL OR "load_releases"."releaseTempC" BETWEEN -40 AND 60)
);
--> statement-breakpoint
ALTER TABLE "load_releases" ADD CONSTRAINT "load_releases_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;