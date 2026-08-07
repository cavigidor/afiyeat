import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface ManagedFolder {
  id: string;
  name: string;
  color: string;
  sort_order?: number | null;
}

export const FOLDER_COLORS = [
  '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
  '#2196F3', '#00BCD4', '#009688', '#4CAF50',
  '#8BC34A', '#CDDC39', '#FFC107', '#FF9800',
];

// Shared add/rename/delete/reorder logic for restaurant types (folders),
// used by both the desktop sidebar (FolderList) and the mobile-reachable
// "Edit Types" sheet - the sidebar is hidden below the lg breakpoint, so
// without a second entry point there was no way to manage types at all on
// the phone app.
export function useFolderManagement(folders: ManagedFolder[], onFoldersChange: () => void) {
  const { user } = useAuth();
  const [isAdding, setIsAdding] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(FOLDER_COLORS[0]);

  const sortedFolders = [...folders].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });

  const handleAddFolder = async () => {
    if (!user || !newFolderName.trim()) return;

    const nextOrder =
      1 + sortedFolders.reduce((max, f) => Math.max(max, f.sort_order ?? -1), -1);

    try {
      const { error } = await supabase.from('folders').insert({
        user_id: user.id,
        name: newFolderName.trim(),
        color: selectedColor,
        sort_order: nextOrder,
      });

      if (error) throw error;

      toast.success('Type created!');
      setNewFolderName('');
      setIsAdding(false);
      onFoldersChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create type');
    }
  };

  const startEditing = (folder: ManagedFolder) => {
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
      toast.success('Type deleted');
      onFoldersChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete type');
    }
  };

  // Reorders by swapping sort_order with the neighboring type in the
  // currently-displayed order - simple and good enough for a single user
  // nudging their own list around.
  const moveFolder = async (id: string, direction: 'up' | 'down') => {
    const idx = sortedFolders.findIndex((f) => f.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= sortedFolders.length) return;

    const current = sortedFolders[idx];
    const neighbor = sortedFolders[swapIdx];
    const currentOrder = current.sort_order ?? idx;
    const neighborOrder = neighbor.sort_order ?? swapIdx;

    try {
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('folders').update({ sort_order: neighborOrder }).eq('id', current.id),
        supabase.from('folders').update({ sort_order: currentOrder }).eq('id', neighbor.id),
      ]);
      if (e1 || e2) throw e1 || e2;
      onFoldersChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reorder types');
    }
  };

  return {
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
  };
}
