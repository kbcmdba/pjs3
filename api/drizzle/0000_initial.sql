CREATE TABLE `workspaceRole` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`value` varchar(64) NOT NULL,
	`sortKey` int unsigned NOT NULL,
	CONSTRAINT `workspaceRole_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspaceRole_value_unique` UNIQUE(`value`)
);
