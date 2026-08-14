import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { FOLDER_COLORS, TYPE_ICON_SUGGESTIONS } from '@/hooks/useFolderManagement';

export interface ManagedListType {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  sort_order?: number | null;
}

export { FOLDER_COLORS, TYPE_ICON_SUGGESTIONS };

// Same add/rename/delete/reorder shape as useFolderManagement, but scoped to
// a single custom list (custom_list_types.list_id) rather than global to the
// user - a movies list and a beers list want completely different type sets.
export function useListTypeManagement(
  listId: string,
  types: ManagedListType[],
  onTypesChange: () => void,
) {
  const { user } = useAuth();
  const [isAdding, setIsAdding] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0]);
  const [selectedIcon, setSelectedIcon] = useState('');
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(FOLDER_COLORS[0]);
  const [editIcon, setEditIcon] = useState('');

  const sortedTypes = [...types].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });

  const handleAddType = async () => {
    if (!user || !newTypeName.trim()) return;

    const nextOrder =
      1 + sortedTypes.reduce((max, t) => Math.max(max, t.sort_order ?? -1), -1);

    try {
      const { error } = await supabase.from('custom_list_types').insert({
        list_id: listId,
        user_id: user.id,
        name: newTypeName.trim(),
        color: selectedColor,
        icon: selectedIcon.trim() || null,
        sort_order: nextOrder,
      });

      if (error) throw error;

      toast.success('Type created!');
      setNewTypeName('');
      setSelectedIcon('');
      setIsAdding(false);
      onTypesChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create type');
    }
  };

  const startEditing = (type: ManagedListType) => {
    setEditingTypeId(type.id);
    setEditName(type.name);
    setEditColor(type.color);
    setEditIcon(type.icon || '');
    setIsAdding(false);
  };

  const cancelEditing = () => {
    setEditingTypeId(null);
    setEditName('');
    setEditIcon('');
  };

  const handleSaveEdit = async () => {
    if (!editingTypeId || !editName.trim()) return;

    try {
      const { error } = await supabase
        .from('custom_list_types')
        .update({ name: editName.trim(), color: editColor, icon: editIcon.trim() || null })
        .eq('id', editingTypeId);

      if (error) throw error;

      toast.success('Type updated!');
      setEditingTypeId(null);
      setEditName('');
      setEditIcon('');
      onTypesChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update type');
    }
  };

  const handleDeleteType = async (id: string) => {
    try {
      const { error } = await supabase.from('custom_list_types').delete().eq('id', id);
      if (error) throw error;
      toast.success('Type deleted');
      onTypesChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete type');
    }
  };

  const moveType = async (id: string, direction: 'up' | 'down') => {
    const idx = sortedTypes.findIndex((t) => t.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= sortedTypes.length) return;

    const current = sortedTypes[idx];
    const neighbor = sortedTypes[swapIdx];
    const currentOrder = current.sort_order ?? idx;
    const neighborOrder = neighbor.sort_order ?? swapIdx;

    try {
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('custom_list_types').update({ sort_order: neighborOrder }).eq('id', current.id),
        supabase.from('custom_list_types').update({ sort_order: currentOrder }).eq('id', neighbor.id),
      ]);
      if (e1 || e2) throw e1 || e2;
      onTypesChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reorder types');
    }
  };

  return {
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
  };
}
