// jsPDF is imported dynamically inside exportListAsPdf rather than at the
// top of this module. MyList imports this file statically, so a top-level
// import pulled the whole PDF stack (jsPDF, plus the html2canvas/dompurify
// chunks it drags along) into the startup path of every single launch - to
// serve one button that most sessions never touch. Loading it at the moment
// someone actually taps Export costs an imperceptible pause there and takes
// a meaningful bite out of cold-launch time everywhere else.

interface ExportRestaurant {
  name: string;
  rating: number | null;
  price_level: number | null;
  notes: string | null;
  status: string;
  folder_ids: string[];
}

interface ExportFolder {
  id: string;
  name: string;
}

export async function exportListAsPdf(
  restaurants: ExportRestaurant[],
  folders: ExportFolder[],
  listTitle: string = 'My Restaurant List'
) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 20;
  const marginRight = 20;
  const contentWidth = pageWidth - marginLeft - marginRight;
  let y = 20;

  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = 20;
    }
  };

  // ─── Title ───
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  const titleWidth = doc.getTextWidth(listTitle);
  const titleX = (pageWidth - titleWidth) / 2;
  doc.text(listTitle, titleX, y);
  // Underline
  doc.setLineWidth(0.5);
  doc.line(titleX, y + 1.5, titleX + titleWidth, y + 1.5);
  y += 14;

  // ─── The Bests ───
  const visitedRestaurants = restaurants.filter(r => r.status === 'went_to' && r.rating !== null);

  // Group by folder - a restaurant tagged with more than one type appears
  // in each of its type's groups, since it genuinely belongs to all of them.
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]));
  const unfolderedKey = '__none__';

  const folderMap = new Map<string, { folderName: string; restaurants: ExportRestaurant[] }>();

  visitedRestaurants.forEach(r => {
    const keys = r.folder_ids && r.folder_ids.length > 0 ? r.folder_ids : [unfolderedKey];
    keys.forEach((key) => {
      const folderName = folderNameById.get(key) || 'Other';
      if (!folderMap.has(key)) {
        folderMap.set(key, { folderName, restaurants: [] });
      }
      folderMap.get(key)!.restaurants.push(r);
    });
  });

  // Compute bests per folder — include ALL ties
  const bests: { category: string; names: string[] }[] = [];
  folderMap.forEach(({ folderName, restaurants: folderRestaurants }) => {
    if (folderRestaurants.length === 0) return;
    const maxRating = Math.max(...folderRestaurants.map(r => r.rating!));
    const topRestaurants = folderRestaurants.filter(r => r.rating === maxRating);
    bests.push({
      category: folderName,
      names: topRestaurants.map(r => r.name),
    });
  });

  if (bests.length > 0) {
    checkPageBreak(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('The Bests', marginLeft, y);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    bests.forEach(({ category, names }) => {
      checkPageBreak(7);
      const line = `${category}: ${names.join(' & ')}`;
      const lines = doc.splitTextToSize(line, contentWidth);
      doc.text(lines, marginLeft, y);
      y += lines.length * 5.5;
    });

    y += 6;
  }

  // ─── Restaurants grouped by folder ───
  // Order: folders first (in original order), then unfiled
  const orderedGroups: { folderName: string; restaurants: ExportRestaurant[] }[] = [];

  folders.forEach(folder => {
    const group = folderMap.get(folder.id);
    if (group && group.restaurants.length > 0) {
      orderedGroups.push(group);
    }
  });

  // Also include "to_go" restaurants in their folders
  const allRestaurantsByFolder = new Map<string, { folderName: string; restaurants: ExportRestaurant[] }>();
  restaurants.forEach(r => {
    const keys = r.folder_ids && r.folder_ids.length > 0 ? r.folder_ids : [unfolderedKey];
    keys.forEach((key) => {
      const folderName = folderNameById.get(key) || 'Other';
      if (!allRestaurantsByFolder.has(key)) {
        allRestaurantsByFolder.set(key, { folderName, restaurants: [] });
      }
      allRestaurantsByFolder.get(key)!.restaurants.push(r);
    });
  });

  // Section title
  checkPageBreak(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Restaurants', marginLeft, y);
  y += 10;

  // Render each folder group
  const renderedFolderKeys = new Set<string>();

  const renderGroup = (folderName: string, items: ExportRestaurant[]) => {
    checkPageBreak(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(folderName, marginLeft, y);
    y += 7;

    // Sort by rating descending (null at bottom)
    const sorted = [...items].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));

    doc.setFontSize(10);
    sorted.forEach(r => {
      const ratingStr = r.rating !== null ? `${r.rating}/10` : 'No rating';
      const priceStr = r.price_level ? ' ' + '$'.repeat(r.price_level) : '';
      const notesStr = r.notes ? `: ${r.notes}` : '';
      const statusTag = r.status === 'to_go' ? ' [To Go]' : '';

      doc.setFont('helvetica', 'bold');
      const nameText = `• ${r.name} - `;
      const nameWidth = doc.getTextWidth(nameText);

      doc.setFont('helvetica', 'normal');
      const detailText = `${ratingStr}${priceStr}${notesStr}${statusTag}`;

      const fullLine = `${nameText}${detailText}`;
      const lines = doc.splitTextToSize(fullLine, contentWidth - 5);

      checkPageBreak(lines.length * 4.5 + 2);

      // Render first line with bold name
      if (lines.length > 0) {
        const firstLine = lines[0] as string;
        // Check if name fits on first line
        if (nameWidth < contentWidth - 5) {
          doc.setFont('helvetica', 'bold');
          doc.text(nameText, marginLeft + 2, y);
          doc.setFont('helvetica', 'normal');
          // Get remainder of first line
          const remainder = firstLine.substring(nameText.length);
          if (remainder) {
            doc.text(remainder, marginLeft + 2 + nameWidth, y);
          }
        } else {
          doc.setFont('helvetica', 'normal');
          doc.text(firstLine, marginLeft + 2, y);
        }
        y += 4.5;
      }

      // Render remaining wrapped lines
      for (let i = 1; i < lines.length; i++) {
        doc.text(lines[i] as string, marginLeft + 6, y);
        y += 4.5;
      }

      y += 1;
    });

    y += 4;
  };

  // Render folders in order
  folders.forEach(folder => {
    const group = allRestaurantsByFolder.get(folder.id);
    if (group && group.restaurants.length > 0) {
      renderGroup(group.folderName, group.restaurants);
      renderedFolderKeys.add(folder.id);
    }
  });

  // Render unfiled
  const unfiledGroup = allRestaurantsByFolder.get(unfolderedKey);
  if (unfiledGroup && unfiledGroup.restaurants.length > 0) {
    renderGroup('Other', unfiledGroup.restaurants);
  }

  // Save
  const safeTitle = listTitle.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
  doc.save(`${safeTitle}.pdf`);
}
