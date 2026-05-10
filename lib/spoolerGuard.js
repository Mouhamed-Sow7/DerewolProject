/**
 * Module spoolerGuard.js
 * Gère la file d'attente des travaux d'impression pour éviter les doublons et les blocages.
 */

class SpoolerGuard {
  constructor() {
    this.queue = new Map(); // jobId -> job object
    this.intervalId = setInterval(() => this.clearStuckJobs(), 60000); // Exécute clearStuckJobs toutes les 60 secondes
  }

  /**
   * Ajoute un travail à la file d'attente.
   * Vérifie les doublons basés sur fileHash et fileName.
   * @param {Object} job - { jobId, fileName, fileHash, timestamp: Date.now(), status: 'pending' }
   * @returns {Object} { allow: boolean, action: 'cancel_old' | 'block_new' | null, message: string | null }
   */
  addToQueue(job) {
    const now = Date.now();
    job.timestamp = job.timestamp || now;
    job.status = job.status || "pending";

    // Chercher un doublon
    let duplicate = null;
    for (const [id, existingJob] of this.queue) {
      if (
        existingJob.fileHash === job.fileHash &&
        existingJob.fileName === job.fileName &&
        existingJob.status === "pending"
      ) {
        duplicate = existingJob;
        break;
      }
    }

    if (duplicate) {
      const diff = now - duplicate.timestamp;
      if (diff > 90000) {
        // 90 secondes
        // Annuler l'ancien, garder le nouveau
        this.queue.delete(duplicate.jobId);
        this.queue.set(job.jobId, job);
        return { allow: true, action: "cancel_old", message: null };
      } else {
        // Bloquer le nouveau
        return {
          allow: false,
          action: "block_new",
          message:
            "Un travail d'impression identique est déjà en cours. Veuillez patienter.",
        };
      }
    } else {
      // Aucun doublon, ajouter
      this.queue.set(job.jobId, job);
      return { allow: true, action: null, message: null };
    }
  }

  /**
   * Supprime les travaux bloqués depuis plus de 2 minutes.
   */
  clearStuckJobs() {
    const now = Date.now();
    const stuckThreshold = 2 * 60 * 1000; // 2 minutes
    for (const [jobId, job] of this.queue) {
      if (now - job.timestamp > stuckThreshold) {
        this.queue.delete(jobId);
        console.log(`Travail bloqué supprimé: ${jobId}`);
      }
    }
  }

  /**
   * Marque un travail comme terminé (optionnel, pour nettoyage manuel).
   * @param {string} jobId
   */
  completeJob(jobId) {
    this.queue.delete(jobId);
  }

  /**
   * Obtient la file d'attente actuelle (pour debug).
   */
  getQueue() {
    return Array.from(this.queue.values());
  }

  /**
   * Nettoie l'intervalle lors de la destruction.
   */
  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

module.exports = SpoolerGuard;
