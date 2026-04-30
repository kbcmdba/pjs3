CREATE TABLE `emailVerificationToken` (
	`emailVerificationTokenId` int unsigned AUTO_INCREMENT NOT NULL,
	`userId` int unsigned NOT NULL,
	`token` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emailVerificationToken_emailVerificationTokenId` PRIMARY KEY(`emailVerificationTokenId`),
	CONSTRAINT `emailVerificationToken_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `passwordResetToken` (
	`passwordResetTokenId` int unsigned AUTO_INCREMENT NOT NULL,
	`userId` int unsigned NOT NULL,
	`token` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passwordResetToken_passwordResetTokenId` PRIMARY KEY(`passwordResetTokenId`),
	CONSTRAINT `passwordResetToken_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`sessionId` int unsigned AUTO_INCREMENT NOT NULL,
	`userId` int unsigned NOT NULL,
	`jti` varchar(36) NOT NULL,
	`currentWorkspaceId` int unsigned NOT NULL,
	`currentRoleId` int unsigned NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`lastActiveAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `session_sessionId` PRIMARY KEY(`sessionId`),
	CONSTRAINT `session_jti_unique` UNIQUE(`jti`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`userId` int unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`emailVerifiedAt` timestamp,
	`sessionIdleTtlMinutes` int unsigned NOT NULL DEFAULT 240,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_userId` PRIMARY KEY(`userId`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`workspaceId` int unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_workspaceId` PRIMARY KEY(`workspaceId`)
);
--> statement-breakpoint
CREATE TABLE `workspaceMember` (
	`workspaceMemberId` int unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` int unsigned NOT NULL,
	`userId` int unsigned NOT NULL,
	`workspaceRoleId` int unsigned NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workspaceMember_workspaceMemberId` PRIMARY KEY(`workspaceMemberId`),
	CONSTRAINT `workspaceMember_workspaceId_userId_unique` UNIQUE(`workspaceId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `workspaceRole` (
	`workspaceRoleId` int unsigned AUTO_INCREMENT NOT NULL,
	`role` varchar(64) NOT NULL,
	`sortKey` int unsigned NOT NULL,
	CONSTRAINT `workspaceRole_workspaceRoleId` PRIMARY KEY(`workspaceRoleId`),
	CONSTRAINT `workspaceRole_role_unique` UNIQUE(`role`)
);
--> statement-breakpoint
ALTER TABLE `emailVerificationToken` ADD CONSTRAINT `emailVerificationToken_userId_user_userId_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `passwordResetToken` ADD CONSTRAINT `passwordResetToken_userId_user_userId_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_userId_user_userId_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_currentWorkspaceId_workspace_workspaceId_fk` FOREIGN KEY (`currentWorkspaceId`) REFERENCES `workspace`(`workspaceId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_currentRoleId_workspaceRole_workspaceRoleId_fk` FOREIGN KEY (`currentRoleId`) REFERENCES `workspaceRole`(`workspaceRoleId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspaceMember` ADD CONSTRAINT `workspaceMember_workspaceId_workspace_workspaceId_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`workspaceId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspaceMember` ADD CONSTRAINT `workspaceMember_userId_user_userId_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspaceMember` ADD CONSTRAINT `workspaceMember_workspaceRoleId_workspaceRole_workspaceRoleId_fk` FOREIGN KEY (`workspaceRoleId`) REFERENCES `workspaceRole`(`workspaceRoleId`) ON DELETE no action ON UPDATE no action;