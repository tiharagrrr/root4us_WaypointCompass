CREATE TABLE "order_day_marks" (
	"kind" text NOT NULL,
	"scopeId" text NOT NULL,
	"deliveryDate" date NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"detail" jsonb,
	CONSTRAINT "order_day_marks_kind_scopeId_deliveryDate_pk" PRIMARY KEY("kind","scopeId","deliveryDate")
);
--> statement-breakpoint
CREATE INDEX "order_day_marks_date_idx" ON "order_day_marks" USING btree ("kind","deliveryDate");