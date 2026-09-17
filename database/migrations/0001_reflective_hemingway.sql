CREATE TABLE "collection_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_area_id" uuid NOT NULL,
	"route_code" varchar(32) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"assigned_collector_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_routes_route_code_unique" UNIQUE("route_code")
);
--> statement-breakpoint
CREATE TABLE "service_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"order_type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"service_account_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"assigned_technician_id" uuid,
	"priority" varchar(16) DEFAULT 'NORMAL' NOT NULL,
	"scheduled_date" date,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"target_address_id" uuid,
	"description" text,
	"resolution_notes" text,
	"materials_used" jsonb,
	"fee_centavos" bigint DEFAULT 0 NOT NULL,
	"disconnection_type" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
ALTER TABLE "collection_areas" ADD COLUMN "code" varchar(32);--> statement-breakpoint
ALTER TABLE "collection_areas" ADD COLUMN "barangay" varchar(64);--> statement-breakpoint
ALTER TABLE "collection_areas" ADD COLUMN "city" varchar(64) DEFAULT 'Malaybalay' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_areas" ADD COLUMN "assigned_collector_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_areas" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_areas" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_areas" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD COLUMN "collection_area_id" uuid;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD COLUMN "collection_route_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_routes" ADD CONSTRAINT "collection_routes_collection_area_id_collection_areas_id_fk" FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_routes" ADD CONSTRAINT "collection_routes_assigned_collector_id_users_id_fk" FOREIGN KEY ("assigned_collector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_assigned_technician_id_users_id_fk" FOREIGN KEY ("assigned_technician_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_target_address_id_subscriber_addresses_id_fk" FOREIGN KEY ("target_address_id") REFERENCES "public"."subscriber_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_areas" ADD CONSTRAINT "collection_areas_assigned_collector_id_users_id_fk" FOREIGN KEY ("assigned_collector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_collection_area_id_collection_areas_id_fk" FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_collection_route_id_collection_routes_id_fk" FOREIGN KEY ("collection_route_id") REFERENCES "public"."collection_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_areas" ADD CONSTRAINT "collection_areas_code_unique" UNIQUE("code");