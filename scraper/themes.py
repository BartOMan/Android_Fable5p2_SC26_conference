"""Curated research themes for the SC26 program.

Each theme is (id, display name, [(regex, weight), ...]). A pattern is matched
case-insensitively against the title and the abstract of every program item.
Title hits count three times. An item belongs to a theme when its score
reaches THRESHOLD. The patterns were tuned against the vocabulary of the SC26
abstracts (see analyze.py --theme-report).
"""

THRESHOLD = 2.0

THEMES = [
    ("llm", "LLMs & Agentic AI", [
        (r"\bllms?\b", 2), (r"large language models?", 2), (r"\bagentic\b", 2), (r"\bai agents?\b", 2),
        (r"multi-?agent", 1.5), (r"foundation models?", 1.5), (r"generative ai|\bgenai\b", 2),
        (r"\bgpt\b|chatgpt|copilot|\bclaude\b|\bgemini\b", 1.5), (r"\brag\b|retrieval-augmented", 1.5),
        (r"prompt(s|ing)?\b", 1), (r"language model", 1), (r"\bagents?\b", 0.5), (r"\btokens?\b", 0.5),
        (r"model context protocol|\bmcp\b", 1.5), (r"ai-assisted|ai assisted|ai coding", 1.5),
    ]),
    ("aisys", "AI Training & Inference Systems", [
        (r"\binference\b", 1.5), (r"llm serving|model serving", 2), (r"distributed training|ai training|model training", 2),
        (r"\btraining\b", 0.5), (r"kv cache", 2), (r"ai workloads?", 1.5), (r"ai infrastructure|ai factor(y|ies)", 2),
        (r"fine-?tuning", 1), (r"deep learning", 1), (r"neural networks?", 1), (r"mixture[- ]of[- ]experts", 1.5),
        (r"\bgnns?\b|graph neural", 1.5), (r"transformers?\b", 1), (r"quantization", 1), (r"ml systems?|mlops", 1.5),
        (r"machine learning", 0.5), (r"pytorch|tensorflow|\bjax\b", 1),
    ]),
    ("ai4sci", "AI for Science", [
        (r"ai for science|ai4s(cience)?", 2.5), (r"surrogate", 2), (r"scientific (machine learning|ml)|\bsciml\b", 2.5),
        (r"physics-informed|neural operators?", 2), (r"scientific discovery", 1.5), (r"scientific ai", 2),
        (r"autonomous (lab|laborator|experiment|discovery)", 2), (r"self-driving lab", 2), (r"genesis mission", 1.5),
        (r"ai-driven|ai driven|ai-enabled|ai enabled", 0.75), (r"science agents?|ai scientists?|co-scientist", 2),
        (r"foundation models? for", 1), (r"emulat(or|ion)", 1),
    ]),
    ("quantum", "Quantum Computing", [
        (r"\bquantum\b", 2), (r"qubits?", 2), (r"\bqpus?\b", 2), (r"error correction", 1), (r"\bnisq\b", 2),
        (r"variational|\bvqe\b|\bqaoa\b", 1), (r"quantum-classical|quantum-hpc|hpc-quantum", 2),
    ]),
    ("gpu", "GPUs & Accelerators", [
        (r"\bgpus?\b", 1), (r"\bcuda\b", 1.5), (r"gpu-accelerated|gpu accelerated|multi-gpu", 1.5),
        (r"accelerators?\b", 1), (r"tensor cores?", 1.5), (r"\bfpgas?\b", 2), (r"wafer-scale|wafer scale", 2),
        (r"\basics?\b|\bnpus?\b|\bdpus?\b", 1.5), (r"\bhip\b|\brocm\b|\boneapi\b", 1.5), (r"gpu memory|gpu kernels?", 1.5),
        (r"heterogeneous (systems?|computing|architectures?)", 1), (r"offload(ing)?", 1),
    ]),
    ("arch", "Processors & Architectures", [
        (r"risc-?v", 2.5), (r"\barm\b|aarch64|\bsve\b|a64fx|graviton", 1.5), (r"processors?\b", 1), (r"\bcpus?\b", 0.5),
        (r"micro-?architecture", 2), (r"\bchips?\b|chiplets?", 1.5), (r"\bsimd\b|vectoriz", 1.5),
        (r"neuromorphic", 2.5), (r"photonic", 2), (r"in-memory computing|processing-in-memory|\bpim\b", 2),
        (r"co-?design", 1.5), (r"architectures?\b", 0.5), (r"hardware design|\brtl\b", 1.5), (r"post-moore|beyond moore", 2),
        (r"reconfigurable", 1.5), (r"instruction set|\bisa\b", 1.5), (r"xeon|epyc|\bgrace\b", 1),
    ]),
    ("memory", "Memory Systems", [
        (r"\bcxl\b", 2.5), (r"disaggregat", 2), (r"persistent memory|non-volatile|\bnvm\b", 2),
        (r"tiered memory|memory tiering|far memory", 2.5), (r"\bhbm\b|high-bandwidth memory|high bandwidth memory", 2),
        (r"memory (hierarchy|management|allocation|bandwidth|systems?|pool|footprint|access)", 1.5),
        (r"\bdram\b", 1.5), (r"page (cache|table|fault)s?|huge ?pages?", 1.5), (r"\bnuma\b", 1.5), (r"memory-bound|memory bound", 1),
    ]),
    ("storage", "Storage & I/O", [
        (r"\bstorage\b", 1.5), (r"\bi/o\b|\bio\b(?! \w*uring)", 1.5), (r"file ?systems?", 2), (r"lustre|\bgpfs\b|\bdaos\b|\bceph\b|beegfs", 2),
        (r"\bhdf5\b|netcdf|adios|zarr|parquet", 2), (r"object stor", 2), (r"burst buffer", 2), (r"parallel i/o", 2.5),
        (r"\bnvme\b|\bssds?\b", 1.5), (r"metadata", 1), (r"checkpoint", 0.75), (r"data lake|archiv", 1),
    ]),
    ("network", "Networking & Interconnects", [
        (r"interconnects?", 2), (r"infiniband|\brdma\b|slingshot|omni-path|ultra ethernet|\broce\b", 2.5),
        (r"\bethernet\b", 1.5), (r"\bnetwork(s|ing)?\b(?! (analysis|model))", 0.75), (r"scinet", 2), (r"topolog(y|ies)", 1),
        (r"routing|congestion", 1.5), (r"data transfer|\bwan\b|wide-area", 1.5), (r"smartnics?|\bdpdk\b|\bp4\b", 2),
        (r"optical|photonics", 1), (r"\b(400|800)g\b|terabit", 2), (r"esnet|internet2|research and education network|\bnren", 2),
        (r"\bsdn\b|software-defined network", 2), (r"network research exhibition|\bnre\b", 2), (r"latency", 0.25),
    ]),
    ("mpi", "MPI & Runtime Systems", [
        (r"\bmpi\b", 2), (r"message passing", 2), (r"\bpgas\b|openshmem|upc\+\+|\bgasnet", 2.5),
        (r"charm\+\+|\blegion\b|\bhpx\b|\bparsec\b|starpu|ompss", 2.5), (r"task-based|many-task|\bamt\b", 2),
        (r"collective communication|collectives", 1.5), (r"runtime systems?", 1.5), (r"\bmpich\b|open ?mpi|mvapich", 2.5),
        (r"overdecomposition|work stealing", 2), (r"partitioned global", 2),
    ]),
    ("progmodel", "Programming Models & Portability", [
        (r"openmp", 2), (r"kokkos|\braja\b|\bsycl\b|openacc|alpaka", 2.5), (r"performance portab", 2.5),
        (r"programming models?", 2), (r"\bfortran\b", 2), (r"\bjulia\b(?! sets?)|\bchapel\b|\brust\b|\bmojo\b", 2),
        (r"\bc\+\+\b", 1), (r"python", 0.75), (r"domain-specific languages?|\bdsls?\b", 2), (r"portab(le|ility)", 1),
        (r"parallel programming", 1.5), (r"std::par|stdpar|parallel stl", 2), (r"productivity", 0.75),
    ]),
    ("compiler", "Compilers & Code Generation", [
        (r"compilers?\b", 2), (r"\bllvm\b|\bmlir\b|\bclang\b|\bflang\b|\bgcc\b", 2.5), (r"code generation", 1.5),
        (r"auto-?tuning", 1.5), (r"auto-?vectoriz", 2), (r"\bjit\b|just-in-time", 1.5),
        (r"intermediate representation|\bir\b", 1.5), (r"transpil|source-to-source|code translation", 2),
        (r"program (analysis|synthesis|transformation)", 1.5), (r"polyhedral", 2.5), (r"automatic differentiation", 2),
    ]),
    ("perf", "Performance Analysis & Tools", [
        (r"profil(ing|er|ers)\b", 2), (r"performance (analysis|model(ing|s)?|engineering|tools?|measurement|variability|counters?)", 2),
        (r"tracing|\btraces?\b", 1.5), (r"benchmark(s|ing)?\b", 1), (r"instrumentation", 1.5),
        (r"debugg(ing|er|ers)", 1.5), (r"hpctoolkit|\btau\b|score-p|caliper|\bpapi\b|vtune|likwid", 2.5),
        (r"bottlenecks?", 1), (r"roofline", 2), (r"observability|telemetry", 1), (r"\bebpf\b", 1.5),
    ]),
    ("numerics", "Numerical Algorithms & Linear Algebra", [
        (r"linear algebra|\bblas\b|lapack", 2.5), (r"\bsparse\b", 1.5), (r"solvers?\b", 1.5), (r"precondition", 2.5),
        (r"multigrid|krylov|conjugate gradient|\bgmres\b", 2.5), (r"eigen(value|solver)", 2.5), (r"\bffts?\b|fourier", 2),
        (r"mixed[- ]precision|low[- ]precision|reduced[- ]precision|half[- ]precision", 2), (r"floating[- ]point", 1.5),
        (r"factorization|\bsvd\b|\bqr\b|\blu\b", 2), (r"matrix", 1), (r"\bspmv\b|\bspgemm\b|\bspmm\b|\bgemm\b", 2.5),
        (r"tensor (decomposition|contraction|network)", 2), (r"finite element|finite volume|finite difference|\bpde", 1.5),
        (r"numerical", 1), (r"stencil", 1.5), (r"randomized", 1),
    ]),
    ("graph", "Graph & Irregular Algorithms", [
        (r"\bgraphs?\b(?! neural)", 1.5), (r"graph (analytics|processing|algorithms?|partitioning|traversal)", 2.5),
        (r"\bbfs\b|breadth-first|pagerank|triangle count|connected components|shortest path", 2.5),
        (r"irregular", 1), (r"combinatorial", 1.5), (r"graph500|graphblas", 2.5), (r"sparse tensors?", 1.5),
        (r"sorting|hash(ing| tables?)", 1.5), (r"string|sequence alignment|genome assembly", 0.75),
    ]),
    ("compress", "Data Compression & Reduction", [
        (r"compress(ion|or|ors|ed|ing)", 2), (r"lossy|lossless", 2), (r"error-bounded|error bounded", 2.5),
        (r"\bsz3?\b|\bzfp\b|\bmgard\b", 2.5), (r"data reduction", 2), (r"decompression", 2),
    ]),
    ("data", "Data Management & Analytics", [
        (r"data (analytics|management|analysis|science|pipelines?|platforms?|lakes?|sharing|curation|governance)", 2),
        (r"databases?\b|\bsql\b|vector search|vector database", 2), (r"\bfair\b|provenance|metadata", 1.5),
        (r"data-intensive|data intensive|big data", 1.5), (r"streaming", 1), (r"\bspark\b|\bdask\b|\bray\b", 1.5),
        (r"datasets?", 0.5), (r"data movement", 1), (r"knowledge graphs?", 1.5), (r"indexing|query", 1),
    ]),
    ("viz", "Visualization & In Situ", [
        (r"visuali[sz]ation", 2), (r"in[- ]situ|in[- ]transit", 2.5), (r"render(ing|er)", 2), (r"virtual reality|\bvr\b|\bxr\b|immersive|augmented reality", 2),
        (r"paraview|\bvisit\b|\bvtk\b|ascent|catalyst", 2), (r"volume render", 2.5), (r"visual analytics", 2.5),
        (r"scientific visuali", 2.5), (r"ray ?tracing", 1.5),
    ]),
    ("workflow", "Workflows & Orchestration", [
        (r"workflows?", 2), (r"orchestrat", 1.5), (r"globus|parsl|pegasus|nextflow|snakemake|airflow|radical|fireworks", 2.5),
        (r"computing continuum|compute continuum", 2), (r"science gateways?|gateway", 1.5),
        (r"integrated research infrastructure|\biri\b", 2.5), (r"automation|automated", 0.5), (r"federat", 1),
        (r"cross-facility|multi-facility|multi-site", 2),
    ]),
    ("sched", "Scheduling & Resource Management", [
        (r"schedul(er|ers|ing)", 2), (r"\bslurm\b|\bflux\b|\bpbs\b|\blsf\b", 2.5), (r"resource (management|manager|allocation)", 2),
        (r"job (scheduling|queue|placement|launch)|batch (system|job)", 2), (r"malleab|elastic (scal|resourc|comput|job|workload|cluster)|elasticity of (resourc|comput)", 1.5),
        (r"co-?scheduling|oversubscription|preemption", 2), (r"queue(s|ing)?\b", 1), (r"\bjobs?\b", 0.5),
        (r"allocation", 0.5), (r"load balancing", 1.5),
    ]),
    ("cloud", "Cloud, Containers & Virtualization", [
        (r"\bcloud\b", 1.5), (r"containers?\b|containeriz", 2), (r"kubernetes|\bk8s\b|docker|apptainer|singularity|podman", 2.5),
        (r"virtuali[sz]ation|virtual machines?|\bvms?\b|hypervisor", 2), (r"serverless|function-as-a-service|\bfaas\b", 2.5),
        (r"multi-tenan", 2), (r"cloud-native|cloud native|hybrid cloud", 2), (r"as-a-service|as a service", 1.5),
        (r"\baws\b|azure|google cloud|\bgcp\b|oracle cloud", 1.5), (r"converged computing", 2), (r"openstack", 2),
    ]),
    ("energy", "Energy, Power & Sustainability", [
        (r"energy[- ]efficien", 2.5), (r"\benergy\b(?! (sciences network|research|department))", 1), (r"\bpower\b(?!ful|ed|s )", 1),
        (r"carbon|emissions?|net[- ]zero", 2.5), (r"sustainab", 1.5), (r"cooling", 2), (r"liquid cool", 2.5),
        (r"\bgreen\b|green500", 1.5), (r"thermal", 1.5), (r"power (management|capping|consumption|cap|budget|grid|draw)", 2.5),
        (r"megawatt|gigawatt|\bmw\b|\bgw\b|\bpue\b", 2), (r"energy (consumption|aware|use|usage|cost)", 2.5), (r"\brapl\b|\bdvfs\b", 2.5),
    ]),
    ("resilience", "Resilience & Reliability", [
        (r"resilien", 2.5), (r"fault[- ]toleran", 2.5), (r"soft errors?|silent data corruption|\bsdcs?\b|bit[- ]flips?", 2.5),
        (r"checkpoint", 1.5), (r"failures?\b", 1), (r"reliab(le|ility)", 1.5), (r"error (detection|resilience|injection)", 2),
        (r"fault injection|\bfaults?\b", 1.5), (r"recovery", 1), (r"anomaly detection", 1.5),
    ]),
    ("security", "Security & Privacy", [
        (r"\bsecur(e|ity)\b|cybersecurity", 2), (r"privacy", 2), (r"zero[- ]trust", 2.5), (r"confidential computing|trusted execution|\btee\b", 2.5),
        (r"encrypt|homomorphic|cryptograph", 2.5), (r"vulnerabilit|attacks?\b|malware|intrusion|threat", 2),
        (r"authenticat|authoriz|identity management|federated identity", 2), (r"side[- ]channel", 2.5), (r"compliance|\bcui\b|\bnist\b", 1.5),
    ]),
    ("ops", "System Operations & Facilities", [
        (r"system administrat|sysadmin", 2.5), (r"operational (data|intelligence|experience|practices?)", 2), (r"\bhpc cent(er|re)s?\b", 1.5),
        (r"data cent(er|re)s?", 1.5), (r"facilit(y|ies)", 1), (r"procurement|acceptance test", 2.5), (r"monitoring", 1.5),
        (r"deployment", 0.75), (r"production (system|hpc|environment)s?", 1.5), (r"user support|help ?desk|ticket", 2),
        (r"operations?\b", 0.75), (r"cluster management|provisioning|\bwarewulf\b|openhpc|\bxcat\b", 2.5), (r"lessons learned", 1),
        (r"state of the practice", 1.5), (r"telemetry|observability", 1.5), (r"upgrade|maintenance|downtime", 1.5),
    ]),
    ("exascale", "Exascale & Leadership Systems", [
        (r"exascale", 2), (r"\bfrontier\b|\baurora\b|el capitan|\bjupiter\b|fugaku|\blumi\b|leonardo|perlmutter|\bsummit\b|alps\b|doudna", 1.5),
        (r"leadership[- ](class|computing|system)", 2), (r"pre-exascale|post-exascale|zettascale", 2.5), (r"top500", 2),
        (r"supercomputers?\b", 0.75), (r"extreme[- ]scale", 1.5), (r"gordon bell", 2),
        (r"\bolcf\b|\balcf\b|\bnersc\b|\bllnl\b|\bornl\b", 1), (r"eurohpc", 2),
    ]),
    ("climate", "Climate, Weather & Earth", [
        (r"climate", 2.5), (r"weather", 2.5), (r"earth system|earth science|geoscien|geophys", 2.5), (r"atmospher|ocean|sea ice", 2),
        (r"seismic|earthquake|tsunami|wildfire|flood|hurricane|typhoon", 2.5), (r"hydrolog|precipitation", 2),
        (r"km-scale|kilometer-scale|global (storm|cloud)-resolving", 2.5), (r"remote sensing|satellite", 1.5),
    ]),
    ("life", "Life Sciences & Health", [
        (r"biomedical|biolog(y|ical)|bioinformatics", 2), (r"genom(e|ic|ics)", 2.5), (r"protein|alphafold", 2.5), (r"drug (discovery|design)", 2.5),
        (r"medical|clinical|health(care)?\b|patient|hospital", 2), (r"cancer|tumor|disease|epidem|pandemic|virus", 2),
        (r"neuroscience|\bbrain\b|connectom", 2), (r"cryo-?em|microscopy", 2), (r"\bdna\b|\brna\b|sequenc(ing|e alignment)", 2),
        (r"\bcell(s|ular)?\b", 1),
    ]),
    ("physics", "Materials, Chemistry & Physics Simulation", [
        (r"molecular dynamics|\blammps\b|\bgromacs\b|\bnamd\b", 2.5), (r"materials?\b (science|discovery|design|modeling)|materials science", 2.5),
        (r"quantum chemistry|electronic structure|density functional|\bdft\b|coupled cluster|ab initio", 2.5),
        (r"chemistry|chemical|catalys", 2), (r"plasma|fusion|tokamak", 2.5), (r"\bcfd\b|fluid dynamics|turbulen|combustion", 2.5),
        (r"lattice qcd|particle physics|high[- ]energy physics|\blhc\b|accelerator physics|nuclear", 2.5),
        (r"astrophys|cosmolog|n-body|galax|gravitational", 2.5), (r"interatomic|force fields?|potentials?\b", 1.5),
        (r"monte carlo", 1.5), (r"simulations?\b", 0.5), (r"multiphysics|hydrodynamics", 2),
    ]),
    ("twin", "Digital Twins", [
        (r"digital twins?", 3), (r"cyber-?physical", 2), (r"real-time simulation|faster-than-real-time", 1.5),
    ]),
    ("edu", "Education, Training & Workforce", [
        (r"education|educators?", 2), (r"workforce", 2.5), (r"curricul|pedagog|classroom|teaching|course(s|work)?\b", 2.5),
        (r"students?\b", 1), (r"hpc training|training (program|material|event|course)s?", 2), (r"mentor(s|ing|ship)?", 2),
        (r"outreach|onboarding", 1.5), (r"career", 1.5), (r"learners?|bootcamp|hackathon|internship", 2),
        (r"undergraduate|graduate students?|k-12", 2), (r"tutorial", 0.5),
    ]),
    ("community", "Community & Inclusion", [
        (r"diversity|inclusi(on|ve|vity)|equity|\bdei\b|underrepresented", 2.5), (r"women in hpc|\bwhpc\b", 3),
        (r"community (building|engagement|of practice)", 2), (r"accessibility", 1.5), (r"well-?being|wellness|burnout|allyship", 2.5),
        (r"networking (event|session|opportunit)|meet[- ]and[- ]greet|meet & greet", 2), (r"\bsighpc\b|\btcpp\b|\bacm\b sig", 1),
        (r"volunteer", 1.5), (r"early[- ]career", 1.5),
    ]),
    ("rse", "Research Software & Reproducibility", [
        (r"research software|\brses?\b", 2.5), (r"software (engineering|sustainability|quality|ecosystem|stack|stewardship|development)", 1.5),
        (r"reproducib|replicab|artifact evaluation", 2.5), (r"continuous integration|\bci/cd\b|\bci\b", 2), (r"\bspack\b|\be4s\b|easybuild|\bconda\b", 2.5),
        (r"\btesting\b|unit tests?|regression test", 1.5), (r"correctness|verification|formal (methods|verification)", 2),
        (r"open[- ]source", 0.75), (r"data races?|race detection|sanitizer", 2), (r"packag(e|ing) manage", 2),
        (r"software supply chain|\bsbom\b", 2), (r"documentation|maintainab|technical debt|legacy code", 1.5),
    ]),
    ("edge", "Edge, Instruments & Real-Time Science", [
        (r"\bedge\b", 2), (r"\biot\b|sensors?\b", 1.5), (r"instruments?\b|beamline|light sources?|synchrotron|telescope|detector", 2),
        (r"experimental (facilit|science|data)", 2), (r"real-time|real time|near-real-time", 0.75), (r"streaming data|data streams?", 1.5),
        (r"experiment steering|autonomous experiment", 2), (r"\b5g\b|\b6g\b|wireless", 2), (r"urgent computing|time-critical", 2.5),
    ]),
    ("policy", "Strategy, Policy & Funding", [
        (r"polic(y|ies)\b(?! (gradient|network|iteration))", 2), (r"national strateg|strategic (plan|priorit|vision|roadmap)", 1.5), (r"funding|investment", 1.5), (r"sovereign", 2.5), (r"roadmap", 1.5),
        (r"national (strategy|initiative|program|priorit)", 2), (r"genesis mission", 2), (r"international (collaboration|cooperation|partnership)", 2),
        (r"\bdoe\b|\bnsf\b|\bnnsa\b|eurohpc|\bnairr\b", 1), (r"export control|geopolit|regulatory|regulations?\b", 2), (r"public-private", 1.5),
        (r"governance", 1), (r"future of (hpc|supercomputing|computing)", 1.5),
    ]),
    ("art", "Art, Culture & History of HPC", [
        (r"\bart\b|artist|artwork|artistic", 2), (r"art of hpc", 3), (r"music|sculpture|painting|gallery|exhibition", 1.5),
        (r"history of|historical|retrospective|anniversary|decades of", 1.5), (r"storytelling|creative|aesthetic", 1.5),
    ]),
]
