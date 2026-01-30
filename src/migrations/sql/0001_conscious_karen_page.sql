ALTER TABLE `users` ADD `nickname` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `users` ADD `email` text NOT NULL DEFAULT 'needupdate@crownkin.space';--> statement-breakpoint
ALTER TABLE `users` ADD `avatar` text;--> statement-breakpoint
ALTER TABLE `users` ADD `description` text;--> statement-breakpoint
-- Migrate existing users: set nickname to username if empty
UPDATE `users` SET `nickname` = `name` WHERE `nickname` = '';