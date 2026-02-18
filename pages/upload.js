import Header from "../components/Header";
import Button from "../components/Button";
import { useState } from "react";

export default function Upload() {
  const [file, setFile] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) {
      alert("Please select a file");
      return;
    }
    // Add upload logic here
    console.log("Uploading:", file);
  };

  return (
    <main>
      <Header />
      <div className="upload-container">
        <h2>Upload File</h2>
        <input type="file" onChange={handleFileChange} />
        <Button onClick={handleUpload}>Upload</Button>
      </div>
    </main>
  );
}
