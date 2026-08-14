import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, X, Check, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import {
  useListTypeManagement,
  FOLDER_COLORS,
  TYPE_ICON_SUGGESTIONS,
  type ManagedListType,
} from '@/hooks/useListTypeManagement';

interface ListTypesManagerProps {
  listId: string;
  types: ManagedListType[];
  onTypesChange: () => void;
  modifyMode: boolean;
  selectedTypeId: string | null;
  onSelectType: (id: string | null) => void;
}

// Per-list types (color + emoji categories), same idea as the restaurant
// "folders" system but scoped to a single custom list. Outside Modify mode
// this renders as simple filter chips (and nothing at all if the list has
// no types yet); Modify mode swaps in the full add/edit/delete/reorder
// manager, mirroring ManageTypesSheet's layout.
export function ListTypesManager({
  listId,
  types,
  onTypesChange,
  modifyMode,
  selectedTypeId,
  onSelectType,
}: ListTypesManagerProps) {
  const {
    sortedTypes,
    isAdding,
    setIsAdding,
    newTypeName,
    setNewTypeName,
    selectedColor,
    setSelectedColor,
    selectedIcon,
    setSelectedIcon,
    editingTypeId,
    editName,
    setEditName,
    editColor,
    setEditColor,
    editIcon,
    setEditIcon,
    handleAddType,
    startEditing,
    cancelEditing,
    handleSaveEdit,
    handleDeleteType,
    moveType,
  } = useListTypeManagement(listId, types, onTypesChange);

  if (!modifyMode) {
    if (sortedTypes.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-0.5">
          Types
        </span>
        <Badge
          variant={selectedTypeId === null ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => onSelectType(null)}
        >
          All
        </Badge>
        {sortedTypes.map((type) => (
          <Badge
            key={type.id}
            variant={selectedTypeId === type.id ? 'default' : 'outline'}
            className="cursor-pointer gap-1.5"
            style={
              selectedTypeId === type.id
                ? { backgroundColor: type.color, borderColor: type.color }
                : undefined
            }
            onClick={() => onSelectType(selectedTypeId === type.id ? null : type.id)}
          >
            {type.icon ? (
              <span className="text-xs leading-none">{type.icon}</span>
            ) : (
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: type.color }} />
            )}
            {type.name}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Types</p>

      {sortedTypes.length === 0 && !isAdding && (
        <p className="text-xs text-muted-foreground">No types yet</p>
      )}

      <div className="space-y-1.5">
        {sortedTypes.map((type, index) => {
          const isEditing = editingTypeId === type.id;

          if (isEditing) {
            return (
              <div key={type.id} className="space-y-2 p-3 bg-muted/50 rounded-lg">
                <Input
                  placeholder="Type name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                  autoFocus
                />
                <div className="flex flex-wrap gap-1">
                  {FOLDER_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setEditColor(color)}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        editColor === color ? 'ring-2 ring-primary ring-offset-2' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <Input
                  placeholder="Pin emoji (optional)"
                  value={editIcon}
                  maxLength={4}
                  onChange={(e) => setEditIcon(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                />
                <div className="flex flex-wrap gap-1">
                  {TYPE_ICON_SUGGESTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setEditIcon(emoji)}
                      className={`w-7 h-7 flex items-center justify-center rounded-md text-base transition-colors ${
                        editIcon === emoji ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-muted-foreground/10'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
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
            <div key={type.id} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-muted/40">
              <button
                onClick={() => startEditing(type)}
                className="w-5 h-5 flex items-center justify-center text-[11px] leading-none rounded-full shrink-0 ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: type.color }}
                aria-label={`Change color/emoji for ${type.name}`}
              >
                {type.icon || ''}
              </button>
              <span className="flex-1 truncate">{type.name}</span>
              <div className="flex items-center shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => moveType(type.id, 'up')}
                  disabled={index === 0}
                  aria-label="Move up"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => moveType(type.id, 'down')}
                  disabled={index === sortedTypes.length - 1}
                  aria-label="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => startEditing(type)}
                  aria-label="Edit type"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteType(type.id)}
                  aria-label="Delete type"
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
            placeholder="Type name"
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddType()}
            autoFocus
          />
          <div className="flex flex-wrap gap-1">
            {FOLDER_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={`w-6 h-6 rounded-full transition-transform ${
                  selectedColor === color ? 'ring-2 ring-primary ring-offset-2' : ''
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <Input
            placeholder="Pin emoji (optional)"
            value={selectedIcon}
            maxLength={4}
            onChange={(e) => setSelectedIcon(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddType()}
          />
          <div className="flex flex-wrap gap-1">
            {TYPE_ICON_SUGGESTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setSelectedIcon(emoji)}
                className={`w-7 h-7 flex items-center justify-center rounded-md text-base transition-colors ${
                  selectedIcon === emoji ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-muted-foreground/10'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddType} className="flex-1">
              <Check className="h-4 w-4 mr-1" /> Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsAdding(false);
                setNewTypeName('');
                setSelectedIcon('');
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add New
        </Button>
      )}
    </div>
  );
}
