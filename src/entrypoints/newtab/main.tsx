import { render } from 'preact';

function App() {
  return (
    <main>
      <h1>Tab Topics</h1>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
