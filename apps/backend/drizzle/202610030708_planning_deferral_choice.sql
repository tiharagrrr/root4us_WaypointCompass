CREATE TYPE "public"."deferral_choice" AS ENUM('UNAVOIDABLE', 'PRIORITY_CHOICE');--> statement-breakpoint
ALTER TABLE "deferrals" ADD COLUMN "choice" "deferral_choice";--> statement-breakpoint
ALTER TABLE "deferrals" ADD COLUMN "bindingRule" text;--> statement-breakpoint
CREATE UNIQUE INDEX "deferrals_live_uq" ON "deferrals" USING btree ("orderId","planId") WHERE status IN ('PROPOSED', 'CONFIRMED') AND partial = false;