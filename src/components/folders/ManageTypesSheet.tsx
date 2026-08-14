import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X, Check, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import {
  useFolderManagement,
  FOLDER_COLORS,
  TYPE_ICON_SUGGESTIONS,
  type ManagedFolder,
} from '@/hooks/useFolderManagement';

interface ManageTypesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: ManagedFolder[];
  onFoldersChange: () => void;
}

// The type-management sidebar (FolderList) only renders on desktop (`hidden
// lg:block`), so it's the only way to add/rename/reorder/delete types -
// meaning there was no way to manage them at all on the phone app. This
// sheet gives mobile (and any screen size, via the toolbar's "Edit Types"
// button) the same capabilities.
export function ManageTypesSheet({ open, onOpenChange, folders, onFoldersChange }: ManageTypesSheetProps) {
  const {
    sortedFolders,
    isAdding,
    setIsAdding,
    newFolderName,
    setNewFolderName,
    selectedColor,
    setSelectedColor,
    selectedIcon,
    setSelectedIcon,
    editingFolderId,
    editName,
    setEditName,
    editColor,
    setEditColor,
    editIcon,
    setEditIcon,
    handleAddFolder,
    startEditing,
    cancelEditing,
    handleSaveEdit,
    handleDeleteFolder,
    moveFolder,
  } = useFolderManagement(folders, onFoldersChange);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl" showCloseButton={false}>
        <SheetHeader className="text-left">
          <div className="flex items-center justify-between">
            <SheetTitle>Edit Types</SheetTitle>
            <SheetClose className="flex items-center justify-center h-8 w-8 -mr-2 rounded-full opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {sortedFolders.map((folder, index) => {
            const isEditing = editingFolderId === folder.id;

            if (isEditing) {
              return (
                <div key={folder.id} className="space-y-2 p-3 bg-muted/50 rounded-lg">
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
              <div
                key={folder.id}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-muted/40"
              >
                <button
                  onClick={() => startEditing(folder)}
                  className="w-5 h-5 flex items-center justify-center text-[11px] leading-none rounded-full shrink-0 ring-1 ring-inset ring-black/10"
                  style={{ backgroundColor: folder.color }}
                  aria-label={`Change color/emoji for ${folder.name}`}
                >
                  {folder.icon || ''}
                </button>
                <span className="flex-1 truncate">{folder.name}</span>
                <div className="flex items-center shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => moveFolder(folder.id, 'up')}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => moveFolder(folder.id, 'down')}
                    disabled={index === sortedFolders.length - 1}
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => startEditing(folder)}
                    aria-label="Edit type"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDeleteFolder(folder.id)}
                    aria-label="Delete type"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          {isAdding ? (
            <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
              <Input
                placeholder="Type name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
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
                onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
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
                <Button size="sm" onClick={handleAddFolder} className="flex-1">
                  <Check className="h-4 w-4 mr-1" /> Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setIsAdding(false);
                    setNewFolderName('');
                    setSelectedIcon('');
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setIsAdding(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Type
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
