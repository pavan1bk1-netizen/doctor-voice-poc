let mediaRecorder;
let audioChunks = [];
let isRecording = false;

document.getElementById("startBtn").addEventListener("click", startRecording);
document.getElementById("stopBtn").addEventListener("click", stopRecording);
document.getElementById("language").addEventListener("change", saveLanguage);

// Load saved language
document.addEventListener("DOMContentLoaded", () => {
  const lang = localStorage.getItem("doctor_voice_language");
  if (lang) document.getElementById("language").value = lang;
});

function saveLanguage() {
  const lang = document.getElementById("language").value;
  localStorage.setItem("doctor_voice_language", lang);
}

async function startRecording() {
  if (isRecording) return;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);

  audioChunks = [];
  isRecording = true;

  mediaRecorder.ondataavailable = (e) => {
    audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    await sendAudioToServer(audioBlob);
  };

  mediaRecorder.start();
  console.log("Recording started...");
}

function stopRecording() {
  if (!isRecording) return;
  mediaRecorder.stop();
  isRecording = false;
  console.log("Recording stopped.");
}

async function sendAudioToServer(audioBlob) {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("language", document.getElementById("language").value);

  const response = await fetch("/process-audio", {
    method: "POST",
    body: formData,
  });

  const result = await response.json();

  document.getElementById("rawText").value = result.rawText || "";
  document.getElementById("doctorOutput").value = result.doctorSummary || "";
}
