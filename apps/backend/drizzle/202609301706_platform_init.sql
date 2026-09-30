CREATE TYPE "public"."alert_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('LATE_RISK', 'FAILED_STOP', 'LOADER_SHORTFALL', 'STORE_ISSUE', 'DRIVER_CANT_RUN', 'VEHICLE_OFFLINE', 'PRIORITY_REQUEST', 'SYNC_CONFLICT');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('POD_PHOTO', 'SIGNATURE', 'EXCEPTION_PHOTO', 'FLAG_PHOTO', 'ISSUE_PHOTO', 'CANT_RUN_PHOTO');--> statement-breakpoint
CREATE TYPE "public"."audit_source" AS ENUM('WEB', 'PWA', 'OFFLINE_SYNC', 'ENGINE', 'SYSTEM', 'SIMULATION', 'WEBHOOK');--> statement-breakpoint
CREATE TYPE "public"."brand" AS ENUM('FRESH', 'STYLE', 'TECH');--> statement-breakpoint
CREATE TYPE "public"."cant_run_reason" AS ENUM('BREAKDOWN', 'COOLING', 'UNWELL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."deferral_source" AS ENUM('ENGINE', 'PLANNING', 'LOAD_CHECK', 'TRACKING');--> statement-breakpoint
CREATE TYPE "public"."deferral_status" AS ENUM('PROPOSED', 'CONFIRMED', 'REVERSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."delivery_outcome" AS ENUM('DELIVERED', 'PARTIAL', 'REFUSED', 'DAMAGED', 'OUTLET_CLOSED');--> statement-breakpoint
CREATE TYPE "public"."depot_kind" AS ENUM('CENTRAL', 'REGIONAL');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('WEB', 'PWA', 'FLUTTER');--> statement-breakpoint
CREATE TYPE "public"."dock_type" AS ENUM('REAR_DOCK', 'STREET', 'MALL_BAY');--> statement-breakpoint
CREATE TYPE "public"."engine_mode" AS ENUM('AUTO_SUGGEST', 'REPAIR');--> statement-breakpoint
CREATE TYPE "public"."engine_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."forecast_source" AS ENUM('BASELINE', 'DATATHON');--> statement-breakpoint
CREATE TYPE "public"."fuel_entry_kind" AS ENUM('PLANNED', 'ACTUAL', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."injection_kind" AS ENUM('VEHICLE_BREAKDOWN', 'DRIVER_OFFLINE', 'ROAD_DELAY', 'FAILED_DELIVERY', 'LOAD_SHORTFALL', 'STORE_ISSUE', 'DEMAND_SPIKE');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."issue_resolution" AS ENUM('CREDIT_ISSUED', 'CREDIT_REQUESTED', 'REDELIVERY', 'NO_ACTION');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."issue_type" AS ENUM('MISSING', 'DAMAGED', 'SHORT', 'TEMPERATURE', 'LATE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."load_flag_decision" AS ENUM('REPLACE', 'REMOVE');--> statement-breakpoint
CREATE TYPE "public"."load_flag_reason" AS ENUM('MISSING', 'DAMAGED', 'WRONG_TEMP', 'OVER_CAPACITY');--> statement-breakpoint
CREATE TYPE "public"."load_flag_status" AS ENUM('OPEN', 'AWAITING_RECHECK', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."load_line_status" AS ENUM('PENDING', 'OK', 'FLAGGED', 'REPLACED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('IN_APP', 'EMAIL', 'SMS', 'PUSH', 'WHATSAPP');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ', 'SUPPRESSED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('DRAFT', 'SUBMITTED', 'CONFIRMED', 'PLANNED', 'DEFERRED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'PARTIAL', 'FAILED', 'RECEIVED', 'ISSUE_REPORTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."parking_constraint" AS ENUM('NORMAL', 'VAN_ONLY', 'MALL_DOCK');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('DRAFT', 'PUBLISHED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('CONFIRMED', 'CONFIRMED_WITH_ISSUES');--> statement-breakpoint
CREATE TYPE "public"."road_class" AS ENUM('URBAN', 'SUBURBAN', 'HIGHWAY', 'HILL');--> statement-breakpoint
CREATE TYPE "public"."simulation_status" AS ENUM('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."stop_event_type" AS ENUM('TRIP_DOWNLOADED', 'TRIP_STARTED', 'ARRIVED', 'DELIVERED', 'PARTIAL', 'FAILED', 'ISSUE_REPORTED', 'CANT_RUN', 'TRIP_COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."stop_status" AS ENUM('PENDING', 'ARRIVED', 'DELIVERED', 'PARTIAL', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."store_response" AS ENUM('AWAITING', 'ACKNOWLEDGED', 'PRIORITY_REQUESTED');--> statement-breakpoint
CREATE TYPE "public"."sync_conflict_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."sync_conflict_resolution" AS ENUM('KEEP_DEVICE', 'KEEP_SERVER');--> statement-breakpoint
CREATE TYPE "public"."temp_class" AS ENUM('AMBIENT', 'CHILLED');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('RESERVED', 'PLANNED', 'LOADING', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('ACTIVE', 'WORKSHOP', 'BREAKDOWN');--> statement-breakpoint
CREATE TYPE "public"."vehicle_temp" AS ENUM('AMBIENT', 'REEFER');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('TRUCK', 'VAN');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'DEAD');--> statement-breakpoint
CREATE SEQUENCE "public"."order_no_fresh_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."order_no_style_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."order_no_tech_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"password" text,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text,
	"platform" "device_platform" NOT NULL,
	"label" text,
	"isDockDevice" boolean DEFAULT false NOT NULL,
	"depotId" text,
	"userAgent" text,
	"appVersion" text,
	"pushEndpoint" text,
	"pushP256dh" text,
	"pushAuth" text,
	"fcmToken" text,
	"lastSeenAt" timestamp with time zone,
	"lastSyncAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_pushEndpoint_unique" UNIQUE("pushEndpoint"),
	CONSTRAINT "devices_fcmToken_unique" UNIQUE("fcmToken")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phoneNumber" text,
	"role" text NOT NULL,
	"depotId" text,
	"outletId" text,
	"vehicleId" text,
	"tokenHash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'PENDING' NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"sentAt" timestamp with time zone,
	"acceptedAt" timestamp with time zone,
	"userId" text,
	"invitedById" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("tokenHash"),
	CONSTRAINT "invitations_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "loader_depots" (
	"userId" text NOT NULL,
	"depotId" text NOT NULL,
	CONSTRAINT "loader_depots_userId_depotId_pk" PRIMARY KEY("userId","depotId")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"impersonatedBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'store_manager' NOT NULL,
	"banned" boolean DEFAULT false,
	"banReason" text,
	"banExpires" timestamp with time zone,
	"username" text,
	"displayUsername" text,
	"phoneNumber" text,
	"phoneNumberVerified" boolean,
	"depotId" text,
	"outletId" text,
	"defaultVehicleId" text,
	"pinHash" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_phoneNumber_unique" UNIQUE("phoneNumber")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_days" (
	"date" date PRIMARY KEY NOT NULL,
	"dow" integer NOT NULL,
	"isWeekend" boolean NOT NULL,
	"isoYear" integer NOT NULL,
	"isoWeek" integer NOT NULL,
	"isPayday" boolean NOT NULL,
	"festival" text,
	"festivalRamp" double precision NOT NULL,
	"isHoliday" boolean NOT NULL,
	"monsoon" boolean NOT NULL,
	"isOperating" boolean NOT NULL,
	CONSTRAINT "calendar_days_dow_chk" CHECK ("calendar_days"."dow" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "depot_waves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"depotId" text NOT NULL,
	"label" text NOT NULL,
	"departFromMin" integer NOT NULL,
	"departToMin" integer NOT NULL,
	"brands" "brand"[] NOT NULL,
	CONSTRAINT "depot_waves_label_uq" UNIQUE("depotId","label"),
	CONSTRAINT "depot_waves_band_chk" CHECK ("depot_waves"."departToMin" >= "depot_waves"."departFromMin")
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "depot_kind" DEFAULT 'CENTRAL' NOT NULL,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"dockCount" integer DEFAULT 6 NOT NULL,
	"chilledDocks" integer DEFAULT 2 NOT NULL,
	"cutoffMin" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depots_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"province" text,
	"depotId" text NOT NULL,
	"roadClass" "road_class" NOT NULL,
	"freeFlowKmh" double precision NOT NULL,
	"depotToDistrictKm" double precision NOT NULL,
	"depotToDistrictMin" double precision NOT NULL,
	"interStopKm" double precision NOT NULL,
	"interStopMin" double precision NOT NULL,
	"centroidLat" double precision,
	"centroidLng" double precision,
	CONSTRAINT "districts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"brand" "brand" NOT NULL,
	"category" text NOT NULL,
	"tempClass" "temp_class" NOT NULL,
	"packLabel" text NOT NULL,
	"unitWeightKg" double precision NOT NULL,
	"unitVolumeM3" double precision NOT NULL,
	"unitValueLkr" integer,
	"barcode" text,
	"fragile" boolean DEFAULT false NOT NULL,
	"isAdjustment" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_sku_unique" UNIQUE("sku"),
	CONSTRAINT "items_barcode_unique" UNIQUE("barcode"),
	CONSTRAINT "items_size_chk" CHECK ("items"."unitWeightKg" > 0 AND "items"."unitVolumeM3" > 0)
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" "brand" NOT NULL,
	"districtId" text NOT NULL,
	"depotId" text NOT NULL,
	"dockType" "dock_type" NOT NULL,
	"parkingConstraint" "parking_constraint" NOT NULL,
	"mallWindowOpenMin" integer,
	"mallWindowCloseMin" integer,
	"windowOpenMin" integer NOT NULL,
	"windowCloseMin" integer NOT NULL,
	"styleDeliveryDow" integer,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"receivingContactName" text,
	"receivingContactPhone" text,
	"accessNotes" text,
	"accessNotesUpdatedAt" timestamp with time zone,
	"accessNotesUpdatedById" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlets_scope_uq" UNIQUE("id","depotId","brand","districtId"),
	CONSTRAINT "outlets_window_chk" CHECK ("outlets"."windowCloseMin" > "outlets"."windowOpenMin"),
	CONSTRAINT "outlets_mall_window_chk" CHECK (("outlets"."mallWindowOpenMin" IS NULL) = ("outlets"."mallWindowCloseMin" IS NULL)
    AND ("outlets"."mallWindowOpenMin" IS NULL OR "outlets"."mallWindowCloseMin" > "outlets"."mallWindowOpenMin")),
	CONSTRAINT "outlets_style_dow_chk" CHECK ("outlets"."styleDeliveryDow" IS NULL OR "outlets"."styleDeliveryDow" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "road_conditions" (
	"date" date NOT NULL,
	"districtId" text NOT NULL,
	"disruptionIndex" double precision NOT NULL,
	CONSTRAINT "road_conditions_date_districtId_pk" PRIMARY KEY("date","districtId")
);
--> statement-breakpoint
CREATE TABLE "service_allowances" (
	"brand" "brand" NOT NULL,
	"dockType" "dock_type" NOT NULL,
	"minutes" double precision NOT NULL,
	CONSTRAINT "service_allowances_brand_dockType_pk" PRIMARY KEY("brand","dockType"),
	CONSTRAINT "service_allowances_minutes_chk" CHECK ("service_allowances"."minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "traffic_speeds" (
	"districtId" text NOT NULL,
	"hour" integer NOT NULL,
	"monsoon" boolean NOT NULL,
	"speedIndex" double precision NOT NULL,
	CONSTRAINT "traffic_speeds_districtId_hour_monsoon_pk" PRIMARY KEY("districtId","hour","monsoon")
);
--> statement-breakpoint
CREATE TABLE "fuel_ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"tripId" uuid,
	"isoYear" integer NOT NULL,
	"isoWeek" integer NOT NULL,
	"date" date NOT NULL,
	"kind" "fuel_entry_kind" NOT NULL,
	"km" double precision NOT NULL,
	"litres" double precision NOT NULL,
	"note" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"registrationNo" text NOT NULL,
	"type" "vehicle_type" NOT NULL,
	"temp" "vehicle_temp" NOT NULL,
	"weightCapKg" double precision NOT NULL,
	"volumeCapM3" double precision NOT NULL,
	"fuelType" text NOT NULL,
	"kmPerL" double precision NOT NULL,
	"weeklyFuelQuotaL" double precision NOT NULL,
	"depotId" text NOT NULL,
	"status" "vehicle_status" DEFAULT 'ACTIVE' NOT NULL,
	"statusReason" text,
	"statusChangedAt" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_code_unique" UNIQUE("code"),
	CONSTRAINT "vehicles_registrationNo_unique" UNIQUE("registrationNo"),
	CONSTRAINT "vehicles_home_uq" UNIQUE("id","depotId"),
	CONSTRAINT "vehicles_caps_chk" CHECK ("vehicles"."weightCapKg" > 0 AND "vehicles"."volumeCapM3" > 0 AND "vehicles"."kmPerL" > 0 AND "vehicles"."weeklyFuelQuotaL" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"itemId" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unitWeightKg" double precision NOT NULL,
	"unitVolumeM3" double precision NOT NULL,
	"unitValueLkr" integer,
	"available" boolean DEFAULT true NOT NULL,
	CONSTRAINT "order_lines_item_uq" UNIQUE("orderId","itemId"),
	CONSTRAINT "order_lines_qty_chk" CHECK ("order_lines"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_template_lines" (
	"templateId" uuid NOT NULL,
	"itemId" uuid NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "order_template_lines_templateId_itemId_pk" PRIMARY KEY("templateId","itemId"),
	CONSTRAINT "order_template_lines_qty_chk" CHECK ("order_template_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outletId" text NOT NULL,
	"name" text NOT NULL,
	"tempClass" "temp_class" NOT NULL,
	"createdById" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_templates_name_uq" UNIQUE("outletId","name")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderNo" text NOT NULL,
	"outletId" text NOT NULL,
	"depotId" text NOT NULL,
	"brand" "brand" NOT NULL,
	"districtId" text NOT NULL,
	"tempClass" "temp_class" NOT NULL,
	"requestedDate" date NOT NULL,
	"deliveryDate" date NOT NULL,
	"status" "order_status" DEFAULT 'DRAFT' NOT NULL,
	"afterCutoff" boolean DEFAULT false NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"weightKg" double precision DEFAULT 0 NOT NULL,
	"volumeM3" double precision DEFAULT 0 NOT NULL,
	"valueLkr" integer,
	"source" text DEFAULT 'web' NOT NULL,
	"externalRef" text,
	"note" text,
	"templateId" uuid,
	"placedById" text,
	"submittedAt" timestamp with time zone,
	"confirmedAt" timestamp with time zone,
	"cancelledAt" timestamp with time zone,
	"cancelReason" text,
	"deferredCount" integer DEFAULT 0 NOT NULL,
	"lastDeferredAt" timestamp with time zone,
	"activeStopId" uuid,
	"parentOrderId" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_orderNo_unique" UNIQUE("orderNo"),
	CONSTRAINT "orders_externalRef_unique" UNIQUE("externalRef"),
	CONSTRAINT "orders_activeStopId_unique" UNIQUE("activeStopId"),
	CONSTRAINT "orders_totals_chk" CHECK ("orders"."weightKg" >= 0 AND "orders"."volumeM3" >= 0 AND "orders"."units" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receiving_roster_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outletId" text NOT NULL,
	"date" date NOT NULL,
	"staffName" text NOT NULL,
	"fromMin" integer NOT NULL,
	"toMin" integer NOT NULL,
	CONSTRAINT "roster_band_chk" CHECK ("receiving_roster_entries"."toMin" > "receiving_roster_entries"."fromMin")
);
--> statement-breakpoint
CREATE TABLE "deferral_reasons" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"fromEngine" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deferrals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"planId" uuid NOT NULL,
	"engineRunId" uuid,
	"status" "deferral_status" DEFAULT 'PROPOSED' NOT NULL,
	"source" "deferral_source" NOT NULL,
	"reasonCode" text NOT NULL,
	"reasonDetail" jsonb,
	"note" text,
	"fromDate" date NOT NULL,
	"toDate" date NOT NULL,
	"priorityScore" double precision,
	"repeatSkip" boolean DEFAULT false NOT NULL,
	"overrideNote" text,
	"swappedForOrderId" uuid,
	"partial" boolean DEFAULT false NOT NULL,
	"decidedById" text,
	"decidedAt" timestamp with time zone,
	"storeResponse" "store_response" DEFAULT 'AWAITING' NOT NULL,
	"storeNote" text,
	"storeRespondedById" text,
	"storeRespondedAt" timestamp with time zone,
	"reversedAt" timestamp with time zone,
	"reversedReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deferrals_dates_chk" CHECK ("deferrals"."toDate" >= "deferrals"."fromDate")
);
--> statement-breakpoint
ALTER TABLE "deferrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engine_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"planId" uuid NOT NULL,
	"mode" "engine_mode" NOT NULL,
	"status" "engine_run_status" DEFAULT 'RUNNING' NOT NULL,
	"engineVersion" text NOT NULL,
	"params" jsonb NOT NULL,
	"inputHash" text NOT NULL,
	"servedCount" integer,
	"deferredCount" integer,
	"stats" jsonb,
	"error" text,
	"triggeredById" text,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"planId" uuid NOT NULL,
	"revision" integer NOT NULL,
	"reasonCode" text NOT NULL,
	"note" text,
	"changes" jsonb NOT NULL,
	"affectedTripIds" uuid[] NOT NULL,
	"affectedOutletIds" text[] NOT NULL,
	"createdById" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_revisions_uq" UNIQUE("planId","revision")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"depotId" text NOT NULL,
	"date" date NOT NULL,
	"status" "plan_status" DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"cutoffClosedAt" timestamp with time zone,
	"createdById" text,
	"publishedAt" timestamp with time zone,
	"publishedById" text,
	"closedAt" timestamp with time zone,
	"closedById" text,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_depot_date_uq" UNIQUE("depotId","date"),
	CONSTRAINT "plans_scope_uq" UNIQUE("id","depotId")
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tripId" uuid NOT NULL,
	"orderId" uuid NOT NULL,
	"outletId" text NOT NULL,
	"depotId" text NOT NULL,
	"brand" "brand" NOT NULL,
	"districtId" text NOT NULL,
	"seq" integer,
	"status" "stop_status" DEFAULT 'PENDING' NOT NULL,
	"plannedArrivalAt" timestamp with time zone,
	"plannedTravelMin" double precision,
	"plannedServiceMin" double precision NOT NULL,
	"predictedServiceMin" double precision,
	"windowOpenMin" integer NOT NULL,
	"windowCloseMin" integer NOT NULL,
	"etaAt" timestamp with time zone,
	"etaUpdatedAt" timestamp with time zone,
	"lateRiskProb" double precision,
	"arrivedAt" timestamp with time zone,
	"arrivedLat" double precision,
	"arrivedLng" double precision,
	"completedAt" timestamp with time zone,
	"outcome" "delivery_outcome",
	"unitsDelivered" integer,
	"receiverName" text,
	"exceptionNote" text,
	"cancelledReason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stops_trip_seq_uq" UNIQUE("tripId","seq"),
	CONSTRAINT "stops_window_chk" CHECK ("stops"."windowCloseMin" > "stops"."windowOpenMin"),
	CONSTRAINT "stops_late_risk_chk" CHECK ("stops"."lateRiskProb" IS NULL OR "stops"."lateRiskProb" BETWEEN 0 AND 1),
	CONSTRAINT "stops_arrived_coords_chk" CHECK (("stops"."arrivedLat" IS NULL OR "stops"."arrivedLat" BETWEEN -90 AND 90)
    AND ("stops"."arrivedLng" IS NULL OR "stops"."arrivedLng" BETWEEN -180 AND 180)),
	CONSTRAINT "stops_units_delivered_chk" CHECK ("stops"."unitsDelivered" IS NULL OR "stops"."unitsDelivered" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"planId" uuid NOT NULL,
	"depotId" text NOT NULL,
	"vehicleId" text NOT NULL,
	"driverId" text,
	"tripNo" integer,
	"brand" "brand" NOT NULL,
	"districtId" text NOT NULL,
	"tempClass" "temp_class" NOT NULL,
	"status" "trip_status" DEFAULT 'PLANNED' NOT NULL,
	"isReserved" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"waveId" uuid,
	"plannedDepartAt" timestamp with time zone,
	"plannedReturnAt" timestamp with time zone,
	"budgetMinutes" double precision DEFAULT 0 NOT NULL,
	"plannedKm" double precision DEFAULT 0 NOT NULL,
	"plannedFuelL" double precision DEFAULT 0 NOT NULL,
	"loadWeightKg" double precision DEFAULT 0 NOT NULL,
	"loadVolumeM3" double precision DEFAULT 0 NOT NULL,
	"releasedAt" timestamp with time zone,
	"releasedById" text,
	"releaseTempC" double precision,
	"downloadedAt" timestamp with time zone,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"cantRunReason" "cant_run_reason",
	"cancelReason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_vehicle_slot_uq" UNIQUE("planId","vehicleId","tripNo"),
	CONSTRAINT "trips_scope_uq" UNIQUE("id","depotId","brand","districtId"),
	CONSTRAINT "trips_trip_no_chk" CHECK ("trips"."tripNo" IS NULL OR "trips"."tripNo" IN (1, 2))
);
--> statement-breakpoint
CREATE TABLE "load_check_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tripId" uuid NOT NULL,
	"orderId" uuid NOT NULL,
	"orderLineId" uuid,
	"stopSeq" integer NOT NULL,
	"status" "load_line_status" DEFAULT 'PENDING' NOT NULL,
	"qtyExpected" integer NOT NULL,
	"qtyLoaded" integer,
	"planRevision" integer NOT NULL,
	"checkedByUserId" text,
	"checkedByName" text,
	"deviceId" text,
	"clientUuid" uuid,
	"checkedAt" timestamp with time zone,
	CONSTRAINT "load_check_lines_clientUuid_unique" UNIQUE("clientUuid"),
	CONSTRAINT "load_lines_qty_chk" CHECK ("load_check_lines"."qtyExpected" >= 0 AND ("load_check_lines"."qtyLoaded" IS NULL OR "load_check_lines"."qtyLoaded" >= 0))
);
--> statement-breakpoint
CREATE TABLE "load_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tripId" uuid NOT NULL,
	"loadLineId" uuid NOT NULL,
	"reason" "load_flag_reason" NOT NULL,
	"qtyAffected" integer NOT NULL,
	"note" text,
	"status" "load_flag_status" DEFAULT 'OPEN' NOT NULL,
	"decision" "load_flag_decision",
	"decisionNote" text,
	"decidedById" text,
	"decidedAt" timestamp with time zone,
	"raisedByName" text NOT NULL,
	"raisedByUserId" text,
	"clientUuid" uuid,
	"raisedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp with time zone,
	CONSTRAINT "load_flags_clientUuid_unique" UNIQUE("clientUuid"),
	CONSTRAINT "load_flags_qty_chk" CHECK ("load_flags"."qtyAffected" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stopId" uuid NOT NULL,
	"orderLineId" uuid NOT NULL,
	"qtyExpected" integer,
	"qtyDelivered" integer NOT NULL,
	"condition" text NOT NULL,
	"note" text,
	CONSTRAINT "delivery_lines_uq" UNIQUE("stopId","orderLineId"),
	CONSTRAINT "delivery_lines_qty_chk" CHECK ("delivery_lines"."qtyDelivered" >= 0 AND ("delivery_lines"."qtyExpected" IS NULL OR "delivery_lines"."qtyExpected" >= 0))
);
--> statement-breakpoint
CREATE TABLE "position_pings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"tripId" uuid,
	"deviceId" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"speedKmh" double precision,
	"heading" double precision,
	"accuracyM" double precision,
	"reeferTempC" double precision,
	"source" text NOT NULL,
	"recordedAt" timestamp with time zone NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pings_vehicle_time_uq" UNIQUE("vehicleId","recordedAt"),
	CONSTRAINT "pings_coords_chk" CHECK ("position_pings"."lat" BETWEEN -90 AND 90 AND "position_pings"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "stop_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clientUuid" uuid NOT NULL,
	"tripId" uuid NOT NULL,
	"stopId" uuid,
	"type" "stop_event_type" NOT NULL,
	"occurredAt" timestamp with time zone NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deviceSeq" integer,
	"lateSync" boolean DEFAULT false NOT NULL,
	"deviceId" text,
	"actorId" text,
	"lat" double precision,
	"lng" double precision,
	"payload" jsonb NOT NULL,
	"appliedAt" timestamp with time zone,
	"supersededAt" timestamp with time zone,
	CONSTRAINT "stop_events_clientUuid_unique" UNIQUE("clientUuid")
);
--> statement-breakpoint
CREATE TABLE "vehicle_positions" (
	"vehicleId" text PRIMARY KEY NOT NULL,
	"tripId" uuid,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"speedKmh" double precision,
	"heading" double precision,
	"accuracyM" double precision,
	"reeferTempC" double precision,
	"source" text NOT NULL,
	"recordedAt" timestamp with time zone NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_coords_chk" CHECK ("vehicle_positions"."lat" BETWEEN -90 AND 90 AND "vehicle_positions"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "sync_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deviceId" text NOT NULL,
	"userId" text NOT NULL,
	"received" integer NOT NULL,
	"applied" integer NOT NULL,
	"duplicates" integer NOT NULL,
	"conflicts" integer NOT NULL,
	"rejected" integer NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"tripId" uuid NOT NULL,
	"stopId" uuid,
	"stopEventId" uuid NOT NULL,
	"deviceRecord" jsonb NOT NULL,
	"serverRecord" jsonb NOT NULL,
	"status" "sync_conflict_status" DEFAULT 'OPEN' NOT NULL,
	"resolution" "sync_conflict_resolution",
	"resolvedById" text,
	"resolvedAt" timestamp with time zone,
	"note" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_conflicts_stopEventId_unique" UNIQUE("stopEventId")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outletId" text NOT NULL,
	"orderId" uuid,
	"stopId" uuid,
	"receiptId" uuid,
	"orderLineId" uuid,
	"type" "issue_type" NOT NULL,
	"qtyAffected" integer,
	"description" text NOT NULL,
	"status" "issue_status" DEFAULT 'OPEN' NOT NULL,
	"resolution" "issue_resolution",
	"resolutionNote" text,
	"raisedById" text NOT NULL,
	"raisedByRole" text NOT NULL,
	"resolvedById" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"receiptId" uuid NOT NULL,
	"orderLineId" uuid NOT NULL,
	"qtyReceived" integer NOT NULL,
	"condition" text NOT NULL,
	CONSTRAINT "receipt_lines_receiptId_orderLineId_pk" PRIMARY KEY("receiptId","orderLineId"),
	CONSTRAINT "receipt_lines_qty_chk" CHECK ("receipt_lines"."qtyReceived" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"stopId" uuid,
	"status" "receipt_status" NOT NULL,
	"note" text,
	"confirmedById" text NOT NULL,
	"confirmedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"awaitingDriverSync" boolean DEFAULT false NOT NULL,
	CONSTRAINT "receipts_orderId_unique" UNIQUE("orderId")
);
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "alert_type" NOT NULL,
	"status" "alert_status" DEFAULT 'OPEN' NOT NULL,
	"severity" integer DEFAULT 2 NOT NULL,
	"depotId" text NOT NULL,
	"planId" uuid,
	"tripId" uuid,
	"stopId" uuid,
	"orderId" uuid,
	"outletId" text,
	"title" text NOT NULL,
	"detail" jsonb,
	"dedupeKey" text NOT NULL,
	"raisedById" text,
	"raisedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledgedById" text,
	"acknowledgedAt" timestamp with time zone,
	"resolvedById" text,
	"resolvedAt" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"actorId" text,
	"actorRole" text,
	"actorName" text,
	"deviceId" text,
	"source" "audit_source" NOT NULL,
	"action" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reasonCode" text,
	"reasonNote" text,
	"occurredAt" timestamp with time zone NOT NULL,
	"recordedAt" timestamp with time zone NOT NULL,
	"correlationId" text,
	"clientUuid" uuid,
	"prevHash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_seq_unique" UNIQUE("seq"),
	CONSTRAINT "audit_events_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"ownerType" text NOT NULL,
	"ownerId" text NOT NULL,
	"storageKey" text NOT NULL,
	"contentType" text NOT NULL,
	"bytes" integer,
	"sha256" text,
	"clientUuid" uuid,
	"capturedAt" timestamp with time zone,
	"uploadedAt" timestamp with time zone,
	"createdById" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storageKey_unique" UNIQUE("storageKey"),
	CONSTRAINT "attachments_clientUuid_unique" UNIQUE("clientUuid")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"authorId" text NOT NULL,
	"authorRole" text NOT NULL,
	"authorName" text,
	"body" text NOT NULL,
	"clientUuid" uuid,
	"readBy" text[] DEFAULT '{}' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_clientUuid_unique" UNIQUE("clientUuid")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"requestHash" text NOT NULL,
	"status" integer NOT NULL,
	"responseBody" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"aggregateType" text NOT NULL,
	"aggregateId" text NOT NULL,
	"depotId" text,
	"outletIds" text[] DEFAULT '{}' NOT NULL,
	"payload" jsonb NOT NULL,
	"correlationId" text,
	"occurredAt" timestamp with time zone DEFAULT now() NOT NULL,
	"publishedAt" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"value" jsonb NOT NULL,
	"updatedById" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_scope_pk" PRIMARY KEY("key","scope")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"userId" text NOT NULL,
	"eventType" text NOT NULL,
	"channels" "notification_channel"[] NOT NULL,
	CONSTRAINT "notification_preferences_userId_eventType_pk" PRIMARY KEY("userId","eventType")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"eventType" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"dedupeKey" text NOT NULL,
	"provider" text,
	"providerMessageId" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sentAt" timestamp with time zone,
	"deliveredAt" timestamp with time zone,
	"readAt" timestamp with time zone,
	"archivedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupeKey_unique" UNIQUE("dedupeKey"),
	CONSTRAINT "notifications_providerMessageId_unique" UNIQUE("providerMessageId")
);
--> statement-breakpoint
CREATE TABLE "inbound_webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"externalId" text NOT NULL,
	"eventType" text,
	"signatureOk" boolean NOT NULL,
	"headers" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"processedAt" timestamp with time zone,
	CONSTRAINT "inbound_webhook_uq" UNIQUE("provider","externalId")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"endpointId" uuid NOT NULL,
	"eventId" uuid NOT NULL,
	"eventType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"responseStatus" integer,
	"responseBody" text,
	"durationMs" integer,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deliveredAt" timestamp with time zone,
	CONSTRAINT "webhook_deliveries_uq" UNIQUE("endpointId","eventId")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secretEnc" text NOT NULL,
	"eventTypes" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdById" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capacity_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"depotId" text NOT NULL,
	"isoYear" integer NOT NULL,
	"isoWeek" integer NOT NULL,
	"vehiclesPlanned" integer,
	"driversPlanned" integer,
	"note" text,
	"createdById" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_plans_uq" UNIQUE("depotId","isoYear","isoWeek"),
	CONSTRAINT "capacity_plans_counts_chk" CHECK (("capacity_plans"."vehiclesPlanned" IS NULL OR "capacity_plans"."vehiclesPlanned" >= 0) AND ("capacity_plans"."driversPlanned" IS NULL OR "capacity_plans"."driversPlanned" >= 0))
);
--> statement-breakpoint
CREATE TABLE "demand_forecasts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"depotId" text NOT NULL,
	"brand" "brand" NOT NULL,
	"isoYear" integer NOT NULL,
	"isoWeek" integer NOT NULL,
	"totalVolumeM3" double precision NOT NULL,
	"chilledVolumeM3" double precision NOT NULL,
	"expectedOrders" integer,
	"source" "forecast_source" NOT NULL,
	"modelVersion" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecasts_uq" UNIQUE("depotId","brand","isoYear","isoWeek","source")
);
--> statement-breakpoint
CREATE TABLE "simulation_injections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"runId" uuid NOT NULL,
	"kind" "injection_kind" NOT NULL,
	"atSim" timestamp with time zone NOT NULL,
	"target" jsonb NOT NULL,
	"params" jsonb,
	"proposedBy" text DEFAULT 'human' NOT NULL,
	"firedAt" timestamp with time zone,
	"outcome" jsonb
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scenarioKey" text NOT NULL,
	"status" "simulation_status" DEFAULT 'DRAFT' NOT NULL,
	"planId" uuid,
	"seed" integer NOT NULL,
	"speed" double precision DEFAULT 60 NOT NULL,
	"simStartAt" timestamp with time zone NOT NULL,
	"simNow" timestamp with time zone,
	"agentic" boolean DEFAULT false NOT NULL,
	"prompt" text,
	"narrative" text,
	"kpis" jsonb,
	"createdById" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_users_id_fk" FOREIGN KEY ("invitedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loader_depots" ADD CONSTRAINT "loader_depots_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loader_depots" ADD CONSTRAINT "loader_depots_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_outletId_outlets_id_fk" FOREIGN KEY ("outletId") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_defaultVehicleId_vehicles_id_fk" FOREIGN KEY ("defaultVehicleId") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_waves" ADD CONSTRAINT "depot_waves_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_districtId_districts_id_fk" FOREIGN KEY ("districtId") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_conditions" ADD CONSTRAINT "road_conditions_districtId_districts_id_fk" FOREIGN KEY ("districtId") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_speeds" ADD CONSTRAINT "traffic_speeds_districtId_districts_id_fk" FOREIGN KEY ("districtId") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_ledger_entries" ADD CONSTRAINT "fuel_ledger_entries_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_ledger_entries" ADD CONSTRAINT "fuel_ledger_entries_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_itemId_items_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_template_lines" ADD CONSTRAINT "order_template_lines_templateId_order_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."order_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_template_lines" ADD CONSTRAINT "order_template_lines_itemId_items_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_templates" ADD CONSTRAINT "order_templates_outletId_outlets_id_fk" FOREIGN KEY ("outletId") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_templateId_order_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."order_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_placedById_users_id_fk" FOREIGN KEY ("placedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_activeStopId_stops_id_fk" FOREIGN KEY ("activeStopId") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_parentOrderId_orders_id_fk" FOREIGN KEY ("parentOrderId") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_scope_fk" FOREIGN KEY ("outletId","depotId","brand","districtId") REFERENCES "public"."outlets"("id","depotId","brand","districtId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_roster_entries" ADD CONSTRAINT "receiving_roster_entries_outletId_outlets_id_fk" FOREIGN KEY ("outletId") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_planId_plans_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_engineRunId_engine_runs_id_fk" FOREIGN KEY ("engineRunId") REFERENCES "public"."engine_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_reasonCode_deferral_reasons_code_fk" FOREIGN KEY ("reasonCode") REFERENCES "public"."deferral_reasons"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_swappedForOrderId_orders_id_fk" FOREIGN KEY ("swappedForOrderId") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_planId_plans_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_planId_plans_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_trip_scope_fk" FOREIGN KEY ("tripId","depotId","brand","districtId") REFERENCES "public"."trips"("id","depotId","brand","districtId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_outlet_scope_fk" FOREIGN KEY ("outletId","depotId","brand","districtId") REFERENCES "public"."outlets"("id","depotId","brand","districtId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_users_id_fk" FOREIGN KEY ("driverId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_districtId_districts_id_fk" FOREIGN KEY ("districtId") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_waveId_depot_waves_id_fk" FOREIGN KEY ("waveId") REFERENCES "public"."depot_waves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_plan_fk" FOREIGN KEY ("planId","depotId") REFERENCES "public"."plans"("id","depotId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_home_fk" FOREIGN KEY ("vehicleId","depotId") REFERENCES "public"."vehicles"("id","depotId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_check_lines" ADD CONSTRAINT "load_check_lines_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_check_lines" ADD CONSTRAINT "load_check_lines_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_check_lines" ADD CONSTRAINT "load_check_lines_orderLineId_order_lines_id_fk" FOREIGN KEY ("orderLineId") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_flags" ADD CONSTRAINT "load_flags_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_flags" ADD CONSTRAINT "load_flags_loadLineId_load_check_lines_id_fk" FOREIGN KEY ("loadLineId") REFERENCES "public"."load_check_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_stopId_stops_id_fk" FOREIGN KEY ("stopId") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_orderLineId_order_lines_id_fk" FOREIGN KEY ("orderLineId") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_pings" ADD CONSTRAINT "position_pings_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_pings" ADD CONSTRAINT "position_pings_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_events" ADD CONSTRAINT "stop_events_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_events" ADD CONSTRAINT "stop_events_stopId_stops_id_fk" FOREIGN KEY ("stopId") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_positions" ADD CONSTRAINT "vehicle_positions_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_stopEventId_stop_events_id_fk" FOREIGN KEY ("stopEventId") REFERENCES "public"."stop_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_outletId_outlets_id_fk" FOREIGN KEY ("outletId") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_stopId_stops_id_fk" FOREIGN KEY ("stopId") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_receiptId_receipts_id_fk" FOREIGN KEY ("receiptId") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_orderLineId_order_lines_id_fk" FOREIGN KEY ("orderLineId") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receiptId_receipts_id_fk" FOREIGN KEY ("receiptId") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_orderLineId_order_lines_id_fk" FOREIGN KEY ("orderLineId") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_stopId_stops_id_fk" FOREIGN KEY ("stopId") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_confirmedById_users_id_fk" FOREIGN KEY ("confirmedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_webhook_endpoints_id_fk" FOREIGN KEY ("endpointId") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_plans" ADD CONSTRAINT "capacity_plans_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_forecasts" ADD CONSTRAINT "demand_forecasts_depotId_depots_id_fk" FOREIGN KEY ("depotId") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_injections" ADD CONSTRAINT "simulation_injections_runId_simulation_runs_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."simulation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "invitations_status_expiry_idx" ON "invitations" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE INDEX "loader_depots_depot_idx" ON "loader_depots" USING btree ("depotId");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "users_role_depot_idx" ON "users" USING btree ("role","depotId");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "calendar_days_iso_week_idx" ON "calendar_days" USING btree ("isoYear","isoWeek");--> statement-breakpoint
CREATE INDEX "items_brand_class_idx" ON "items" USING btree ("brand","tempClass","active");--> statement-breakpoint
CREATE INDEX "outlets_depot_brand_district_idx" ON "outlets" USING btree ("depotId","brand","districtId");--> statement-breakpoint
CREATE INDEX "fuel_vehicle_week_idx" ON "fuel_ledger_entries" USING btree ("vehicleId","isoYear","isoWeek");--> statement-breakpoint
CREATE INDEX "fuel_trip_idx" ON "fuel_ledger_entries" USING btree ("tripId");--> statement-breakpoint
CREATE INDEX "vehicles_depot_status_idx" ON "vehicles" USING btree ("depotId","status");--> statement-breakpoint
CREATE INDEX "orders_depot_date_status_idx" ON "orders" USING btree ("depotId","deliveryDate","status");--> statement-breakpoint
CREATE INDEX "orders_outlet_date_class_idx" ON "orders" USING btree ("outletId","requestedDate","tempClass");--> statement-breakpoint
CREATE INDEX "orders_parent_idx" ON "orders" USING btree ("parentOrderId");--> statement-breakpoint
CREATE INDEX "roster_outlet_date_idx" ON "receiving_roster_entries" USING btree ("outletId","date");--> statement-breakpoint
CREATE INDEX "deferrals_order_idx" ON "deferrals" USING btree ("orderId","createdAt");--> statement-breakpoint
CREATE INDEX "deferrals_plan_status_idx" ON "deferrals" USING btree ("planId","status");--> statement-breakpoint
CREATE INDEX "engine_runs_plan_idx" ON "engine_runs" USING btree ("planId","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "stops_live_order_uq" ON "stops" USING btree ("orderId") WHERE status NOT IN ('CANCELLED', 'FAILED');--> statement-breakpoint
CREATE INDEX "stops_order_idx" ON "stops" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "trips_plan_status_idx" ON "trips" USING btree ("planId","status");--> statement-breakpoint
CREATE INDEX "trips_driver_status_idx" ON "trips" USING btree ("driverId","status");--> statement-breakpoint
CREATE INDEX "trips_vehicle_idx" ON "trips" USING btree ("vehicleId");--> statement-breakpoint
CREATE INDEX "load_lines_trip_seq_idx" ON "load_check_lines" USING btree ("tripId","stopSeq");--> statement-breakpoint
CREATE INDEX "load_flags_trip_status_idx" ON "load_flags" USING btree ("tripId","status");--> statement-breakpoint
CREATE INDEX "pings_trip_time_idx" ON "position_pings" USING btree ("tripId","recordedAt");--> statement-breakpoint
CREATE INDEX "stop_events_trip_time_idx" ON "stop_events" USING btree ("tripId","occurredAt");--> statement-breakpoint
CREATE INDEX "stop_events_stop_idx" ON "stop_events" USING btree ("stopId");--> statement-breakpoint
CREATE INDEX "sync_batches_device_idx" ON "sync_batches" USING btree ("deviceId","receivedAt");--> statement-breakpoint
CREATE INDEX "sync_conflicts_status_idx" ON "sync_conflicts" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "issues_outlet_status_idx" ON "issues" USING btree ("outletId","status");--> statement-breakpoint
CREATE INDEX "issues_order_idx" ON "issues" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "issues_receipt_idx" ON "issues" USING btree ("receiptId");--> statement-breakpoint
CREATE INDEX "alerts_depot_status_idx" ON "alerts" USING btree ("depotId","status","raisedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_dedupe_uq" ON "alerts" USING btree ("dedupeKey") WHERE status <> 'RESOLVED';--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entityType","entityId","seq");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_events" USING btree ("action","recordedAt");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actorId","recordedAt");--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("ownerType","ownerId");--> statement-breakpoint
CREATE INDEX "comments_entity_idx" ON "comments" USING btree ("entityType","entityId","createdAt");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_keys" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox_events" USING btree ("publishedAt","occurredAt");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox_events" USING btree ("aggregateType","aggregateId");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("userId","channel","readAt");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "injections_run_time_idx" ON "simulation_injections" USING btree ("runId","atSim");--> statement-breakpoint
CREATE POLICY "order_lines_app_scope" ON "order_lines" AS PERMISSIVE FOR ALL TO "compass_app" USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = "order_lines"."orderId")) WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = "order_lines"."orderId"));--> statement-breakpoint
CREATE POLICY "order_lines_readonly" ON "order_lines" AS PERMISSIVE FOR SELECT TO "compass_readonly" USING (true);--> statement-breakpoint
CREATE POLICY "orders_app_scope" ON "orders" AS PERMISSIVE FOR ALL TO "compass_app" USING ((
  coalesce(current_setting('app.role', true), '') IN ('admin', 'system')
  OR (coalesce(current_setting('app.role', true), '') = 'dispatcher' AND (coalesce(current_setting('app.depot_id', true), '') = '' OR "orders"."depotId" = coalesce(current_setting('app.depot_id', true), '')))
  OR (coalesce(current_setting('app.role', true), '') = 'loader' AND "orders"."depotId" = coalesce(current_setting('app.depot_id', true), ''))
  OR (coalesce(current_setting('app.role', true), '') = 'store_manager' AND "orders"."outletId" = current_setting('app.outlet_id', true))
  OR (coalesce(current_setting('app.role', true), '') = 'driver' AND EXISTS (SELECT 1 FROM stops s JOIN trips tr ON tr.id = s."tripId"
      WHERE s."orderId" = "orders"."id" AND tr."driverId" = current_setting('app.user_id', true))))) WITH CHECK ((
  coalesce(current_setting('app.role', true), '') IN ('admin', 'system')
  OR (coalesce(current_setting('app.role', true), '') = 'dispatcher' AND (coalesce(current_setting('app.depot_id', true), '') = '' OR "orders"."depotId" = coalesce(current_setting('app.depot_id', true), '')))
  OR (coalesce(current_setting('app.role', true), '') = 'loader' AND "orders"."depotId" = coalesce(current_setting('app.depot_id', true), ''))
  OR (coalesce(current_setting('app.role', true), '') = 'store_manager' AND "orders"."outletId" = current_setting('app.outlet_id', true))
  OR (coalesce(current_setting('app.role', true), '') = 'driver' AND EXISTS (SELECT 1 FROM stops s JOIN trips tr ON tr.id = s."tripId"
      WHERE s."orderId" = "orders"."id" AND tr."driverId" = current_setting('app.user_id', true)))));--> statement-breakpoint
CREATE POLICY "orders_readonly" ON "orders" AS PERMISSIVE FOR SELECT TO "compass_readonly" USING (true);--> statement-breakpoint
CREATE POLICY "deferrals_app_scope" ON "deferrals" AS PERMISSIVE FOR ALL TO "compass_app" USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = "deferrals"."orderId")) WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = "deferrals"."orderId"));--> statement-breakpoint
CREATE POLICY "deferrals_readonly" ON "deferrals" AS PERMISSIVE FOR SELECT TO "compass_readonly" USING (true);--> statement-breakpoint
CREATE POLICY "issues_app_scope" ON "issues" AS PERMISSIVE FOR ALL TO "compass_app" USING ((
  coalesce(current_setting('app.role', true), '') IN ('admin', 'system')
  OR (coalesce(current_setting('app.role', true), '') = 'dispatcher' AND (coalesce(current_setting('app.depot_id', true), '') = '' OR EXISTS (SELECT 1 FROM outlets ou
      WHERE ou.id = "issues"."outletId" AND ou."depotId" = coalesce(current_setting('app.depot_id', true), ''))))
  OR (coalesce(current_setting('app.role', true), '') = 'store_manager' AND "issues"."outletId" = current_setting('app.outlet_id', true))
  OR (coalesce(current_setting('app.role', true), '') = 'driver' AND EXISTS (SELECT 1 FROM stops s JOIN trips tr ON tr.id = s."tripId"
      WHERE s.id = "issues"."stopId" AND tr."driverId" = current_setting('app.user_id', true))))) WITH CHECK ((
  coalesce(current_setting('app.role', true), '') IN ('admin', 'system')
  OR (coalesce(current_setting('app.role', true), '') = 'dispatcher' AND (coalesce(current_setting('app.depot_id', true), '') = '' OR EXISTS (SELECT 1 FROM outlets ou
      WHERE ou.id = "issues"."outletId" AND ou."depotId" = coalesce(current_setting('app.depot_id', true), ''))))
  OR (coalesce(current_setting('app.role', true), '') = 'store_manager' AND "issues"."outletId" = current_setting('app.outlet_id', true))
  OR (coalesce(current_setting('app.role', true), '') = 'driver' AND EXISTS (SELECT 1 FROM stops s JOIN trips tr ON tr.id = s."tripId"
      WHERE s.id = "issues"."stopId" AND tr."driverId" = current_setting('app.user_id', true)))));--> statement-breakpoint
CREATE POLICY "issues_readonly" ON "issues" AS PERMISSIVE FOR SELECT TO "compass_readonly" USING (true);--> statement-breakpoint
CREATE POLICY "receipts_app_scope" ON "receipts" AS PERMISSIVE FOR ALL TO "compass_app" USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = "receipts"."orderId")) WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = "receipts"."orderId"));--> statement-breakpoint
CREATE POLICY "receipts_readonly" ON "receipts" AS PERMISSIVE FOR SELECT TO "compass_readonly" USING (true);