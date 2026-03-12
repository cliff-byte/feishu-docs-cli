/**
 * Map document object type to Feishu Drive API type parameter.
 */

const DRIVE_TYPE_MAP: Record<string, string> = {
  docx: "docx",
  doc: "doc",
  sheet: "sheet",
  bitable: "bitable",
  mindnote: "mindnote",
  board: "board",
  wiki: "wiki",
};

export function mapToDriveType(objType: string): string {
  return DRIVE_TYPE_MAP[objType] || "docx";
}
