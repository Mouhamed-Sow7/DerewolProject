/*
------------  jobStore.js   ---------
path DEREWOL/derewolprint/renderer/js/state
JOB :

• garde la liste des jobs
• notifie l’UI quand ça change
• devient la source unique de vérité                 

*/
const jobStore = (() => {
  let jobs = [];
  let listeners = [];

  function notify() {
    listeners.forEach((cb) => cb(jobs));
  }

  return {
    getJobs() {
      return jobs;
    },

    subscribe(callback) {
      listeners.push(callback);

      // envoyer état actuel immédiatement
      callback(jobs);

      return () => {
        listeners = listeners.filter((l) => l !== callback);
      };
    },

    addJob(job) {
      jobs = [...jobs, job];
      notify();
    },

    removeJob(id) {
      jobs = jobs.filter((job) => job.id !== id);
      notify();
    },

    setJobs(newJobs) {
      jobs = newJobs;
      notify();
    },
  };
})();

export default jobStore;
