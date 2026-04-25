CREATE TABLE `workspaceRole` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`role` varchar(64) NOT NULL,
	`sortKey` int unsigned NOT NULL,
	CONSTRAINT `workspaceRole_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspaceRole_role_unique` UNIQUE(`role`)
);
