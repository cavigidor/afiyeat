import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface ManagedListStatus {
  id: string;
  name: string;
  sort_order?: number | null;
}

// Add/rename/delete/reorder for a list's own custom statuses - same shape
// as useListTypeManagement, minus color/icon (a status is just a label and
// a position), plus a guard useListTypeManagement doesn't need: a list
// must always keep at least one status, since every item has to belong to
// something.
export function useListStatusManagement(
  listId: string,
  statuses: ManagedListStatus[],
  onStatusesChange: () => void,
) {
  const { user } = useAuth();
  const [isAdding, setIsAdding] = useState(false);
  const [newStatusName, setNewStatusName] = useState('');
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const sortedStatuses = [...statuses].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });

  const handleAddStatus = async () => {
    if (!user || !newStatusName.trim()) return;

    const nextOrder =
      1 + sortedStatuses.reduce((max, s) => Math.max(max, s.sort_order ?? -1), -1);

    try {
      const { error } = await supabase.from('custom_list_statuses').insert({
        list_id: listId,
        user_id: user.id,
        name: newStatusName.trim(),
        sort_order: nextOrder,
      });

      if (error) throw error;

      toast.success('Status added!');
      setNewStatusName('');
      setIsAdding(false);
      onStatusesChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add status');
    }
  };

  const startEditing = (status: ManagedListStatus) => {
    setEditingStatusId(status.id);
    setEditName(status.name);
    setIsAdding(false);
  };

  const cancelEditing = () => {
    setEditingStatusId(null);
    setEditName('');
  };

  const handleSaveEdit = async () => {
    if (!editingStatusId || !editName.trim()) return;

    try {
      const { error } = await supabase
        .from('custom_list_statuses')
        .update({ name: editName.trim() })
        .eq('id', editingStatusId);

      if (error) throw error;

      toast.success('Status updated!');
      setEditingStatusId(null);
      setEditName('');
      onStatusesChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update status');
    }
  };

  // Every item currently on this status is moved to whatever status is
  // first in order (excluding the one being deleted) before the row is
  // actually removed - the DB's ON DELETE SET NULL would otherwise leave
  // those items with no status at all.
  const handleDeleteStatus = async (id: string) => {
    if (sortedStatuses.length <= 1) {
      toast.error('A list needs at least one status');
      return;
    }

    try {
      const fallback = sortedStatuses.find((s) => s.id !== id);
      if (fallback) {
        const { error: reassignError } = await supabase
          .from('custom_list_items')
          .update({ status_id: fallback.id })
          .eq('status_id', id);
        if (reassignError) throw reassignError;
      }

      const { error } = await supabase.from('custom_list_statuses').delete().eq('id', id);
      if (error) throw error;
      toast.success('Status deleted');
      onStatusesChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete status');
    }
  };

  const moveStatus = async (id: string, direction: 'up' | 'down') => {
    const idx = sortedStatuses.findIndex((s) => s.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= sortedStatuses.length) return;

    const current = sortedStatuses[idx];
    const neighbor = sortedStatuses[swapIdx];
    const currentOrder = current.sort_order ?? idx;
    const neighborOrder = neighbor.sort_order ?? swapIdx;

    try {
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('custom_list_statuses').update({ sort_order: neighborOrder }).eq('id', current.id),
        supabase.from('custom_list_statuses').update({ sort_order: currentOrder }).eq('id', neighbor.id),
      ]);
      if (e1 || e2) throw e1 || e2;
      onStatusesChange();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reorder statuses');
    }
  };

  return {
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
  };
}
