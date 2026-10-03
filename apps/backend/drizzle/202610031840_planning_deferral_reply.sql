ALTER TABLE "deferrals" ADD COLUMN "dispatcherReply" text;--> statement-breakpoint
ALTER TABLE "deferrals" ADD COLUMN "dispatcherRepliedById" text;--> statement-breakpoint
ALTER TABLE "deferrals" ADD COLUMN "dispatcherRepliedAt" timestamp with time zone;