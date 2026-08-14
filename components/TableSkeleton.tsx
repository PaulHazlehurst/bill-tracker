export default function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="table-wrap">
      <table className="bill-table">
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              <td style={{ width: 32 }}><div className="skeleton-block" style={{ width: 16, height: 16 }} /></td>
              <td><div className="skeleton-block" style={{ width: "70%", height: 14 }} /></td>
              <td><div className="skeleton-block" style={{ width: 70, height: 20 }} /></td>
              <td><div className="skeleton-block" style={{ width: 60, height: 18 }} /></td>
              <td><div className="skeleton-block" style={{ width: 80, height: 6 }} /></td>
              <td><div className="skeleton-block" style={{ width: 90, height: 12 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
