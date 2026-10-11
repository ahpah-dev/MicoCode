import {createRoot} from 'react-dom/client';
import Workspace from '../../components/micocode/workspace';
import '../../app/globals.css';
import '../../app/semantic.css';
import '../../app/product.css';

createRoot(document.getElementById('root')!).render(<Workspace/>);
