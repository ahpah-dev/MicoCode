import {createRoot} from 'react-dom/client';
import Workspace from '../../components/micocode/workspace';
import {ErrorBoundary} from '../../components/micocode/error-boundary';
import '../../app/globals.css';
import '../../app/semantic.css';
import '../../app/product.css';
import '../../app/visual.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Workspace/>
  </ErrorBoundary>
);
import '../../app/polish.css';

