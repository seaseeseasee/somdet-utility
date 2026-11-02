export function Placeholder({ title, sprint, mockup }: { title: string; sprint: number; mockup: string }) {
  return (
    <div className="card stack">
      <h3>{title}</h3>
      <div className="note blue">
        หน้านี้อยู่ในแผน Sprint {sprint} ยังไม่ได้พัฒนา ดูภาพ Mockup ที่อนุมัติได้ที่ <code>docs/mockups/{mockup}</code>
      </div>
    </div>
  );
}
