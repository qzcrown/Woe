CREATE TABLE `plugin_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`plugin_id` integer NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` integer NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`last_error_code` text,
	`last_error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_jobs_active_subject_unique` ON `plugin_jobs` (`plugin_id`,`subject_type`,`subject_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `plugin_jobs_status_created_idx` ON `plugin_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `plugin_jobs_user_subject_idx` ON `plugin_jobs` (`user_id`,`subject_type`,`subject_id`);--> statement-breakpoint
ALTER TABLE `plugin_configs` ADD `encrypted_secret` text;--> statement-breakpoint
ALTER TABLE `plugin_configs` ADD `usage_day` text;--> statement-breakpoint
ALTER TABLE `plugin_configs` ADD `usage_count` integer DEFAULT 0 NOT NULL;
