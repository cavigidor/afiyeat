import { useState } from 'react';
import { sortByTypeOrder } from '@/lib/typeOrder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Folder, X, Check, Trash2, Pencil, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Restaurant {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  folder_id: string | null;
}

interface FolderListProps {
  folders: { id: string; name: string; color: string }[];
  selectedFolder: string | null;
  onSelectFolder: (id: string | null) => void;
  onFoldersChange: () => void;
  restaurants?: Restaurant[];
  onRestaurantClick?: (restaurant: Restaurant) => void;
}

const FOLDER_COLORS = [
  '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
  '#2196F3', '#00BCD4', '#009688', '#4CAF50',
  '#8BC34A', '#CDDC39', '#FFC107', '#FF9800',
];

export function FolderList({
  folders,
  selectedFolder,
  onSelectFolder,
  onFoldersChange,
  restaurants = [],
  onRestaurantClick,
}: FolderListProps) {
  const { user } = useAuth();
  const [isAdding, setIsAdding] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0]);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(FOLDER_COLORS[0]);

  const handleAddFolder = async () => {
    if (!user || !newFolderName.trim()) return;

    try {
      const { error } = await supabase.from('folders').insert({
        user_id: user.id,
        name: newFolderName.trim(),
        color: selectedColor,
      });

      if (error) throw error;

      toast.success('Folder created!');
      setNewFolderName('');
      setIsAdding(false);
      onFoldersChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create folder');
    }
  };

  const startEditing = (folder: { id: string; name: string; color: string }) => {
    setEditingFolderId(folder.id);
    setEditName(folder.name);
    setEditColor(folder.color);
    setIsAdding(false);
  };

  const cancelEditing = () => {
    setEditingFolderId(null);
    setEditName('');
  };

  const handleSaveEdit = async () => {
    if (!editingFolderId || !editName.trim()) return;

    try {
      const { error } = await supabase
        .from('folders')
        .update({ name: editName.trim(), color: editColor })
        .eq('id', editingFolderId);

      if (error) throw error;

      toast.success('Type updated!');
      setEditingFolderId(null);
      setEditName('');
      onFoldersChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update type');
    }
  };

  const handleDeleteFolder = async (id: string) => {
    try {
      const { error } = await supabase.from('folders').delete().eq('id', id);
      if (error) throw error;
      
      if (selectedFolder === id) {
        onSelectFolder(null);
      }
      toast.success('Folder deleted');
      onFoldersChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete folder');
    }
  };

  const toggleExpand = (folderId: string) => {
    setExpandedFolder(expandedFolder === folderId ? null : folderId);
  };

  const getRestaurantsInFolder = (folderId: string) => {
    return restaurants.filter(r => r.folder_id === folderId);
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

        {sortByTypeOrder(folders, (f) => f.name).map((folder) => {
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
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
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
                  className="flex-1 flex items-center gap-2 text-left"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: folder.color }}
                  />
                  <span className="truncate">{folder.name}</span>
                  <span className="text-xs opacity-60">({folderRestaurants.length})</span>
                </button>
                <button
                  onClick={() => startEditing(folder)}
                  className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted-foreground/20 ${
                    selectedFolder === folder.id ? 'hover:bg-primary-foreground/20' : ''
                  }`}
                  aria-label="Edit type"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => handleDeleteFolder(folder.id)}
                  className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/20 ${
                    selectedFolder === folder.id ? 'hover:bg-primary-foreground/20' : ''
                  }`}
                  aria-label="Delete type"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
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
