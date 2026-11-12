ALTER TABLE `users` ADD COLUMN `year_of_study` text;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `responsibility_areas` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `deleted_by_user_id` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `deletion_reason` text;
--> statement-breakpoint
CREATE TABLE `guideline_acceptances` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `version` text NOT NULL,
  `accepted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_guideline_acceptances_user_version` ON `guideline_acceptances` (`user_id`, `version`);
--> statement-breakpoint
CREATE TABLE `student_incidents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `kind` text NOT NULL,
  `reference` text NOT NULL,
  `description` text NOT NULL,
  `explanation` text NOT NULL,
  `decision` text NOT NULL,
  `review` text NOT NULL,
  `recorded_by_user_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_student_incidents_reference` ON `student_incidents` (`user_id`, `kind`, `reference`);
--> statement-breakpoint
CREATE INDEX `idx_student_incidents_user` ON `student_incidents` (`user_id`, `kind`);
--> statement-breakpoint
CREATE TABLE `student_restrictions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `scope` text DEFAULT 'facilities' NOT NULL,
  `reason` text NOT NULL,
  `starts_at` text NOT NULL,
  `ends_at` text NOT NULL,
  `created_by_user_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `lifted_at` text,
  `lifted_by_user_id` integer,
  `lift_reason` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`lifted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_student_restrictions_user` ON `student_restrictions` (`user_id`, `starts_at`, `ends_at`);
--> statement-breakpoint
CREATE TABLE `booking_participants` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `booking_id` integer NOT NULL,
  `user_id` integer NOT NULL,
  `status` text DEFAULT 'invited' NOT NULL,
  `invited_by_user_id` integer,
  `invited_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `responded_at` text,
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_booking_participants_unique` ON `booking_participants` (`booking_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `idx_booking_participants_user` ON `booking_participants` (`user_id`, `status`);
