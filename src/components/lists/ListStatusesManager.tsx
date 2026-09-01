import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X, Check, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import { useListStatusManagement, type ManagedListStatus } from '@/hooks/useListStatusManagement';

interface ListStatusesManagerProps {
  listId: string;
  statuses: ManagedListStatus[];
  onStatusesChange: () => void;
}

// Modify-mode manager for a list's own custom statuses (the columns items
// move through - "To Watch" / "Watched", or as many stages as the list
// owner wants). Mirrors ListTypesManager's add/edit/delete/reorder layout,
// minus color/icon since a status is just a label and a position.
export function ListStatusesManager({ listId, statuses, onStatusesChange }: ListStatusesManagerProps) {
  const {
    sortedStatuses,
    isAdding,
    setIsAdding,
    newStatusName,
    setNewStatusName,
    editingStatusId,
    editName,
    setEditName,
    handleAddStatus,
    startEditing,
    cancelEditing,
    handleSaveEdit,
    handleDeleteStatus,
    moveStatus,
  } = useListStatusManagement(listId, statuses, onStatusesChange);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Statuses</p>
      <p className="text-xs text-muted-foreground -mt-1">
        The stages items move through on this list - add as many as you want, or just keep one.
      </p>

      <div className="space-y-1.5">
        {sortedStatuses.map((status, index) => {
          const isEditing = editingStatusId === status.id;

          if (isEditing) {
            return (
              <div key={status.id} className="space-y-2 p-3 bg-muted/50 rounded-lg">
                <Input
                  placeholder="Status name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveEdit} className="flex-1">
                    <Check className="h-4 w-4 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelEditing}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <div key={status.id} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-muted/40">
              <span className="flex-1 truncate">{status.name}</span>
              <div className="flex items-center shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => moveStatus(status.id, 'up')}
                  disabled={index === 0}
                  aria-label="Move up"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => moveStatus(status.id, 'down')}
                  disabled={index === sortedStatuses.length - 1}
                  aria-label="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => startEditing(status)}
                  aria-label="Rename status"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteStatus(status.id)}
                  disabled={sortedStatuses.length <= 1}
                  aria-label="Delete status"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {isAdding ? (
        <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
          <Input
            placeholder="Status name"
            value={newStatusName}
            onChange={(e) => setNewStatusName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddStatus()}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddStatus} className="flex-1">
              <Check className="h-4 w-4 mr-1" /> Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsAdding(false);
                setNewStatusName('');
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Status
        </Button>
      )}
    </div>
  );
}
