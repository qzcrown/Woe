CREATE TABLE `user_plugin_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_path` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_plugin_permissions_user_id_module_path_unique` ON `user_plugin_permissions` (`user_id`,`module_path`);