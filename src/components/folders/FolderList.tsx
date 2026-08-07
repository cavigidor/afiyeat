import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Folder, X, Check, Trash2, Pencil, ChevronUp, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { useFolderManagement, FOLDER_COLORS, type ManagedFolder } from '@/hooks/useFolderManagement';
import { useState } from 'react';

interface Restaurant {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  folder_id: string | null;
}

interface FolderListProps {
  folders: ManagedFolder[];
  selectedFolder: string | null;
  onSelectFolder: (id: string | null) => void;
  onFoldersChange: () => void;
  restaurants?: Restaurant[];
  onRestaurantClick?: (restaurant: Restaurant) => void;
}

export function FolderList({
  folders,
  selectedFolder,
  onSelectFolder,
  onFoldersChange,
  restaurants = [],
  onRestaurantClick,
}: FolderListProps) {
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const {
    sortedFolders,
    isAdding,
    setIsAdding,
    newFolderName,
    setNewFolderName,
    selectedColor,
    setSelectedColor,
    editingFolderId,
    editName,
    setEditName,
    editColor,
    setEditColor,
    handleAddFolder,
    startEditing,
    cancelEditing,
    handleSaveEdit,
    handleDeleteFolder,
    moveFolder,
  } = useFolderManagement(folders, onFoldersChange);

  const toggleExpand = (folderId: string) => {
    setExpandedFolder(expandedFolder === folderId ? null : folderId);
  };

  const getRestaurantsInFolder = (folderId: string) => {
    return restaurants.filter(r => r.folder_id === folderId);
  };

  const handleDelete = (id: string) => {
    if (selectedFolder === id) onSelectFolder(null);
    handleDeleteFolder(id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
          Types
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsAdding(true)}
          className="h-7 px-2"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {isAdding && (
        <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
          <Input
            placeholder="Type name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
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
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <button
          onClick={() => onSelectFolder(null)}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            selectedFolder === null
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted'
          }`}
        >
          <Folder className="h-4 w-4" />
          All Restaurants
        </button>

        {sortedFolders.map((folder, index) => {
          const folderRestaurants = getRestaurantsInFolder(folder.id);
          const isExpanded = expandedFolder === folder.id;
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
            <div key={folder.id}>
              <div
                className={`group flex items-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedFolder === folder.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {folderRestaurants.length > 0 && (
                  <button
                    onClick={() => toggleExpand(folder.id)}
                    className="p-0.5 -ml-1"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => onSelectFolder(folder.id)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: folder.color }}
                  />
                  <span className="truncate">{folder.name}</span>
                  <span className="text-xs opacity-60 shrink-0">({folderRestaurants.length})</span>
                </button>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => moveFolder(folder.id, 'up')}
                    disabled={index === 0}
                    className={`p-1 rounded hover:bg-muted-foreground/20 disabled:opacity-30 disabled:pointer-events-none ${
                      selectedFolder === folder.id ? 'hover:bg-primary-foreground/20' : ''
                    }`}
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => moveFolder(folder.id, 'down')}
                    disabled={index === sortedFolders.length - 1}
                    className={`p-1 rounded hover:bg-muted-foreground/20 disabled:opacity-30 disabled:pointer-events-none ${
                      selectedFolder === folder.id ? 'hover:bg-primary-foreground/20' : ''
                    }`}
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => startEditing(folder)}
                    className={`p-1 rounded hover:bg-muted-foreground/20 ${
                      selectedFolder === folder.id ? 'hover:bg-primary-foreground/20' : ''
                    }`}
                    aria-label="Edit type"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(folder.id)}
                    className={`p-1 rounded hover:bg-destructive/20 ${
                      selectedFolder === folder.id ? 'hover:bg-primary-foreground/20' : ''
                    }`}
                    aria-label="Delete type"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Expanded restaurant list */}
              {isExpanded && folderRestaurants.length > 0 && (
                <div className="ml-6 mt-1 space-y-0.5">
                  {folderRestaurants.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => onRestaurantClick?.(r)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
                    >
                      <MapPin className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
