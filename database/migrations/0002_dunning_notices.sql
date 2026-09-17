CREATE TABLE IF NOT EXISTS "dunning_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_number" varchar(32) NOT NULL,
	"service_account_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"notice_level" integer DEFAULT 1 NOT NULL,
	"status" varchar(32) DEFAULT 'ISSUED' NOT NULL,
	"overdue_balance_centavos" bigint NOT NULL,
	"days_overdue" integer DEFAULT 0 NOT NULL,
	"oldest_invoice_due_date" date,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid,
	"delivered_at" timestamp with time zone,
	"delivered_by" uuid,
	"delivery_notes" text,
	"resolved_at" timestamp with time zone,
	"resolved_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dunning_notices_notice_number_unique" UNIQUE("notice_number")
);
--> statement-breakpoint
ALTER TABLE "dunning_notices" ADD CONSTRAINT "dunning_notices_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_notices" ADD CONSTRAINT "dunning_notices_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_notices" ADD CONSTRAINT "dunning_notices_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_notices" ADD CONSTRAINT "dunning_notices_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
