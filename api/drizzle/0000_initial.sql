CREATE TABLE `workspaceRole` (
	`workspaceRoleId` int unsigned AUTO_INCREMENT NOT NULL,
	`role` varchar(64) NOT NULL,
	`sortKey` int unsigned NOT NULL,
	CONSTRAINT `workspaceRole_workspaceRoleId` PRIMARY KEY(`workspaceRoleId`),
	CONSTRAINT `workspaceRole_role_unique` UNIQUE(`role`)
);
