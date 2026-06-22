import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { qb, sql } from "@/lib/lix-kysely";
import { useLix, useQuery, useQueryTakeFirstOrThrow } from "@/lib/lix-react";
import { Button } from "@/components/ui/button";
import { flushMarkdownAutosaves } from "@/extensions/markdown/editor/autosave-flush";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Check,
	ChevronDown,
	GitBranch,
	Loader2,
	MoreVertical,
	PenLine,
	Plus,
	Trash2,
} from "lucide-react";
import clsx from "clsx";

type BranchRow = {
	id: string;
	name: string;
	hidden: boolean | null;
	commit_id: string | null;
};

/**
 * Dropdown trigger that lists available branches and switches the active one.
 *
 * Branches are queried reactively from the underlying Lix store. Selecting
 * another branch updates the workspace branch via `lix.switchBranch`, which
 * in turn refreshes any subscribers (e.g. editors watching the active branch).
 *
 * @example
 * <BranchSwitcher />
 */
export function BranchSwitcher() {
	const lix = useLix();
	const branches = useQuery<BranchRow>((lix) =>
		qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "name", "hidden", "commit_id"])
			.where(
				() =>
					sql`COALESCE(CAST(lix_branch.hidden AS TEXT), 'false') NOT IN ('true', '1', 't')`,
			)
			.orderBy("name", "asc"),
	);

	return <BranchSwitcherWithActiveBranch lix={lix} branches={branches} />;
}

function BranchSwitcherWithActiveBranch({
	lix,
	branches,
}: {
	readonly lix: ReturnType<typeof useLix>;
	readonly branches: BranchRow[];
}) {
	const activeBranch = useQueryTakeFirstOrThrow<{ value: string }>(() =>
		qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select(["value"]),
	);
	return (
		<BranchSwitcherContent
			lix={lix}
			branches={branches}
			activeBranchId={activeBranch.value}
		/>
	);
}

function BranchSwitcherContent({
	lix,
	branches,
	activeBranchId,
}: {
	readonly lix: ReturnType<typeof useLix>;
	readonly branches: BranchRow[];
	readonly activeBranchId: string;
}) {
	const activeBranchRow =
		branches.find((branch) => branch.id === activeBranchId) ??
		({
			id: activeBranchId,
			name: activeBranchId,
			hidden: false,
			commit_id: null,
		} satisfies BranchRow);

	const [pendingAction, setPendingAction] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [isCreatingBranch, setIsCreatingBranch] = useState(false);
	const [newBranchName, setNewBranchName] = useState("");
	const [actionError, setActionError] = useState<string | null>(null);
	const newBranchNameInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!isCreatingBranch) return;
		newBranchNameInputRef.current?.focus();
		newBranchNameInputRef.current?.select();
	}, [isCreatingBranch]);

	const isBusy = pendingAction !== null;

	const handleSwitch = useCallback(
		async (branchId: string) => {
			if (!lix || isBusy || branchId === activeBranchRow.id) return;
			setPendingAction(branchId);
			setActionError(null);
			try {
				await flushMarkdownAutosaves();
				await lix.switchBranch({ branchId });
			} catch (error) {
				console.error("Failed to switch branch", error);
				setActionError("Could not switch branch.");
			} finally {
				setPendingAction(null);
			}
		},
		[lix, isBusy, activeBranchRow.id],
	);

	const createBranch = useCallback(
		async (name: string) => {
			if (!lix || isBusy) return;
			const suggestion = `draft-${branches.length + 1}`;
			const trimmed = name.trim();
			setPendingAction("create");
			setActionError(null);
			try {
				const created = await lix.createBranch({
					name: trimmed.length > 0 ? trimmed : suggestion,
				});
				await flushMarkdownAutosaves();
				await lix.switchBranch({ branchId: created.id });
				setIsCreatingBranch(false);
				setNewBranchName("");
				setMenuOpen(false);
			} catch (error) {
				console.error("Failed to create branch", error);
				setActionError("Could not create branch.");
			} finally {
				setPendingAction(null);
			}
		},
		[lix, isBusy, branches.length],
	);

	const handleStartCreateBranch = useCallback(() => {
		setNewBranchName(`draft-${branches.length + 1}`);
		setIsCreatingBranch(true);
	}, [branches.length]);

	const handleCreateBranchSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			event.stopPropagation();
			void createBranch(newBranchName);
		},
		[createBranch, newBranchName],
	);

	const handleRenameBranch = useCallback(
		async (branchId: string, currentName: string) => {
			if (isBusy) return;
			const entered = window.prompt("Rename branch", currentName);
			if (entered === null) return;
			const trimmed = entered.trim();
			if (trimmed === "" || trimmed === currentName) return;
			setPendingAction(branchId);
			setActionError(null);
			try {
				await qb(lix)
					.updateTable("lix_branch")
					.set({ name: trimmed })
					.where("id", "=", branchId)
					.execute();
			} catch (error) {
				console.error("Failed to rename branch", error);
				setActionError("Could not rename branch.");
			} finally {
				setPendingAction(null);
			}
		},
		[lix, isBusy],
	);

	const handleDeleteBranch = useCallback(
		async (branchId: string, branchName: string) => {
			if (isBusy) return;
			if (branchId === activeBranchRow.id) {
				window.alert("Cannot delete the active branch.");
				return;
			}
			const confirmed = window.confirm(
				`Delete branch "${branchName}"? This will hide it from the list.`,
			);
			if (!confirmed) return;
			setPendingAction(branchId);
			setActionError(null);
			const currentActiveId = activeBranchRow.id;
			try {
				await qb(lix)
					.updateTable("lix_branch")
					.set({ hidden: true })
					.where("id", "=", branchId)
					.execute();
				if (currentActiveId) {
					await lix.switchBranch({ branchId: currentActiveId });
				}
				setMenuOpen(false);
			} catch (error) {
				console.error("Failed to delete branch", error);
				setActionError("Could not delete branch.");
			} finally {
				setPendingAction(null);
			}
		},
		[lix, isBusy, activeBranchRow.id],
	);

	const buttonLabel = `${activeBranchRow.name}`;

	return (
		<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="inline-flex h-5.5 items-center gap-1 rounded-md px-1.5 font-normal text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
					aria-label="Select branch"
					disabled={isBusy}
				>
					<GitBranch className="size-3" />
					<span className="text-[11.5px]">{buttonLabel}</span>
					{isBusy ? (
						<Loader2 className="size-2.5 animate-spin" />
					) : (
						<ChevronDown className="size-2.5" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="min-w-45 text-xs"
				align="start"
				sideOffset={6}
			>
				<DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
					Branches
				</DropdownMenuLabel>
				{branches.length === 0 ? (
					<div className="px-3 py-2 text-muted-foreground">
						No branches available
					</div>
				) : (
					branches.map((branch) => {
						const isActive = branch.id === activeBranchRow.id;
						const isDeleteDisabled = isActive;
						const branchLabelId = `branch-switcher-label-${branch.id}`;
						return (
							<DropdownMenuItem
								key={branch.id}
								aria-labelledby={branchLabelId}
								onSelect={(event) => {
									type DropdownSelectEvent = Event & {
										detail?: { originalEvent?: Event };
									};
									const originalTarget = (event as DropdownSelectEvent).detail
										?.originalEvent?.target as HTMLElement | undefined;
									if (originalTarget?.closest("[data-branch-actions]")) {
										event.preventDefault();
										return;
									}
									void handleSwitch(branch.id);
								}}
								className={clsx(
									"group flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs",
									isActive
										? "text-[var(--color-text-primary)]"
										: "text-[var(--color-text-secondary)]",
								)}
							>
								<span className="flex w-3 justify-center" aria-hidden>
									{isActive ? (
										<Check className="h-3 w-3 text-[var(--color-icon-brand)]" />
									) : null}
								</span>
								<span id={branchLabelId} className="truncate">
									{branch.name}
								</span>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											className="ml-auto flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
											data-branch-actions
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
											}}
										>
											<span className="sr-only">
												Branch actions for {branch.name}
											</span>
											<MoreVertical
												className="h-3.5 w-3.5 text-[var(--color-icon-tertiary)]"
												aria-hidden="true"
											/>
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="start"
										side="right"
										className="min-w-40 text-xs"
									>
										<DropdownMenuItem
											className="flex items-center gap-2 text-xs"
											onSelect={(event) => {
												event.preventDefault();
												void handleRenameBranch(branch.id, branch.name);
											}}
										>
											<PenLine className="h-3 w-3" />
											<span>Rename</span>
										</DropdownMenuItem>
										<DropdownMenuItem
											className="flex items-center gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:!text-destructive"
											onSelect={() => {
												if (isDeleteDisabled) return;
												void handleDeleteBranch(branch.id, branch.name);
											}}
											disabled={isDeleteDisabled}
										>
											<Trash2 className="h-3 w-3" />
											<span>Delete</span>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</DropdownMenuItem>
						);
					})
				)}
				{actionError ? (
					<div
						className="px-2 py-1.5 text-xs text-[var(--color-text-notice-danger)]"
						role="alert"
					>
						{actionError}
					</div>
				) : null}
				<DropdownMenuSeparator />
				{isCreatingBranch ? (
					<form
						className="flex items-center gap-1.5 px-2 py-1.5"
						onSubmit={handleCreateBranchSubmit}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Escape") {
								event.preventDefault();
								setIsCreatingBranch(false);
								setNewBranchName("");
							}
						}}
					>
						<input
							ref={newBranchNameInputRef}
							aria-label="Branch name"
							className="h-6 min-w-0 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
							value={newBranchName}
							onChange={(event) => setNewBranchName(event.target.value)}
						/>
						<Button
							type="submit"
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-xs"
							disabled={pendingAction === "create"}
						>
							Create
						</Button>
					</form>
				) : (
					<DropdownMenuItem
						onSelect={(event) => {
							event.preventDefault();
							handleStartCreateBranch();
						}}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							handleStartCreateBranch();
						}}
						className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--color-text-secondary)]"
					>
						<Plus className="h-3 w-3" />
						<span>Create branch</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
