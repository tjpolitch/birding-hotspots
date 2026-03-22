import Papa from 'papaparse';
import { useState, useEffect, useMemo } from 'react';
import HotspotMap from './components/Map';

function App() {
  const [fileName, setFileName] = useState("");
  const [data, setData] = useState<any[]>([]);
  const [selectedState, setSelectedState] = useState("AU-ACT");
  const [selectedCounty, setSelectedCounty] = useState("");
  const [hotspots, setHotspots] = useState<any[]>([]);
  const [showUnvisitedOnly, setShowUnvisitedOnly] = useState(false);

  function handleFileUpload(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setData(results.data as any[]);
      }
    });
  }

  useEffect(() => {
    setSelectedCounty("");
  }, [selectedState]);

  // 🌍 Dynamic hotspot fetch
  useEffect(() => {
    if (!selectedState) return;

    async function fetchHotspots() {
      try {
        const res = await fetch(
          `https://api.ebird.org/v2/ref/hotspot/${selectedState}?fmt=json`,
          {
            headers: {
              "X-eBirdApiToken": "o5mp766m7big",
              "Accept": "application/json"
            }
          }
        );

        const data = await res.json();
        setHotspots(data);
      } catch (err) {
        console.error(err);
      }
    }

    fetchHotspots();
  }, [selectedState]);

  // Dropdowns
  const states = Array.from(
    new Set(data.map(r => r["State/Province"]?.trim()).filter(Boolean))
  ).sort();

  const counties = Array.from(
    new Set(
      data
        .filter(r => !selectedState || r["State/Province"] === selectedState)
        .map(r => r["County"]?.trim())
        .filter(Boolean)
    )
  ).sort();

  const filteredData = data.filter(r =>
    (!selectedState || r["State/Province"] === selectedState) &&
    (!selectedCounty || r["County"] === selectedCounty)
  );

  const visitedHotspots = new Set(
    filteredData
      .map(r => r["Location ID"]?.trim())
      .filter((id: any) => id && id.startsWith("L"))
  );

  // Completion
  const visitedCount = hotspots.filter(h =>
    visitedHotspots.has(h.locId)
  ).length;

  const completion =
    hotspots.length > 0
      ? Math.round((visitedCount / hotspots.length) * 100)
      : 0;

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: '0 auto' }}>
      <h2>Upload your eBird CSV</h2>

      <input type="file" accept=".csv" onChange={handleFileUpload} />
      {fileName && <p>Uploaded: {fileName}</p>}

      <br /><br />

      <label>State:</label>
      <select value={selectedState} onChange={e => setSelectedState(e.target.value)}>
        {states.map(s => <option key={s}>{s}</option>)}
      </select>

      <br /><br />

      <label>County:</label>
      <select value={selectedCounty} onChange={e => setSelectedCounty(e.target.value)}>
        <option value="">All</option>
        {counties.map(c => <option key={c}>{c}</option>)}
      </select>

      <p>Visited hotspots: {visitedHotspots.size}</p>
      <p><strong>Completion: {completion}%</strong></p>

      <label style={{ display: 'block', marginTop: '10px' }}>
        <input
          type="checkbox"
          checked={showUnvisitedOnly}
          onChange={(e) => setShowUnvisitedOnly(e.target.checked)}
        />
        {' '}Show only unvisited hotspots
      </label>

      <HotspotMap
        hotspots={
          showUnvisitedOnly
            ? hotspots.filter(h => !visitedHotspots.has(h.locId))
            : hotspots
        }
        visitedHotspots={visitedHotspots}
/>
    </div>
  );
}

export default App;