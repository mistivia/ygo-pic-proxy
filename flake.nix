{
    description = "Haskell project";

    inputs = {
        nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
        flake-utils.url = "github:numtide/flake-utils";
    };

    outputs = { self, nixpkgs, flake-utils}:
        flake-utils.lib.eachDefaultSystem (system:
        let
            pkgs = nixpkgs.legacyPackages.${system};
            haskellPackages = pkgs.haskellPackages.override {
                overrides = self: super: {};
            };
            project = haskellPackages.callCabal2nix "ygo-pic-proxy" ./. {};
            devTools = with haskellPackages; [
                cabal-install
                hoogle
                haskell-language-server
            ];

        in {
            packages.default = project;
            devShells.default = haskellPackages.shellFor {
                packages = p: [ project ];
                nativeBuildInputs = devTools;
            };
        });
}
